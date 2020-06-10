import { getDMMF } from "@prisma/sdk";
import { getPaths, processPagesDir } from "@redwoodjs/internal/dist/paths";
import {
  FieldDefinitionNode,
  ObjectTypeDefinitionNode,
} from "graphql/language/ast";
import { parse as parseGraphQL } from "graphql/language/parser";
import { LazyGetter as lazy } from "lazy-get-decorator";
import { Memoize as memo } from "lodash-decorators";
import { basename, dirname, join } from "path";
import * as tsm from "ts-morph";
import {
  DiagnosticSeverity,
  Location,
  Range,
} from "vscode-languageserver-types";
import { RWError } from "./errors";
import {
  basenameNoExt,
  BaseNode,
  Definition,
  DiagnosticWithLocation,
  err,
  FileNode,
  Host,
  Implementation,
  Location_fromFilePath,
  Location_fromNode,
  offset2position,
  OutlineItem,
} from "./ide";
import {
  directoryNameResolver,
  followsDirNameConvention,
  isCellFileName,
  isLayoutFileName,
  validatePath,
} from "./util";

export interface RWProjectOptions {
  projectRoot: string;
  host: Host;
}

const allFilesGlob = "/**/*.{js,jsx,ts,tsx}";
const fullDocRange: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

/**
 * Represents a Redwood project.
 * This is the root node.
 */
export class RWProject extends BaseNode implements OutlineItem {
  constructor(public opts: RWProjectOptions) {
    super();
  }
  parent = undefined;

  get host() {
    return this.opts.host;
  }

  get projectRoot() {
    return this.opts.projectRoot;
  }

  get id() {
    return this.projectRoot;
  }

  outlineLabel = "Redwood.js";

  @lazy() get outlineChildren() {
    const self = this;
    return [
      {
        id: "pages",
        outlineLabel: "pages",
        get outlineChildren() {
          return self.pages;
        },
      },
      {
        id: "routes",
        outlineLabel: "routes",
        get outlineChildren() {
          return self.router.routes;
        },
      },
      // add more stuff
    ];
  }

  children() {
    return [
      this.redwood_toml,
      ...this.pages,
      this.router,
      ...this.services,
      ...this.sdls,
      ...this.layouts,
      ...this.components,
    ];
  }

  /**
   * Path constants that are relevant to a Redwood project.
   */
  @lazy() get pathHelper() {
    return getPaths(this.projectRoot);
  }
  /**
   * Checks for the presence of a tsconfig.json at the root.
   * TODO: look for this file at the root? or within each side? (api/web)
   */
  @lazy() get isTypeScriptProject(): boolean {
    return this.host.existsSync(join(this.projectRoot, "tsconfig.json"));
  }
  // TODO: do we move this to a separate node? (ex: RWDatabase)
  @memo() async prisma_dmmf() {
    return await getDMMF({
      datamodel: this.host.readFileSync(this.pathHelper.api.dbSchema),
    });
  }
  @memo() async prisma_dmmf_modelNames() {
    return (await this.prisma_dmmf()).datamodel.models.map((m) => m.name);
  }
  @lazy() get redwood_toml(): RWTOML {
    return new RWTOML(join(this.projectRoot, "netlify.toml"), this);
  }
  @lazy() private get processPagesDir() {
    return processPagesDir(this.pathHelper.web.pages);
  }
  @lazy() get pages(): RWPage[] {
    return this.processPagesDir.map((p) => new RWPage(p.const, p.path, this));
  }
  @lazy() get router() {
    return new RWRouter(this.pathHelper.web.routes, this);
  }

  servicesFilePath(name: string) {
    // name = blog,posts
    return join(this.pathHelper.api.services, name, name + ".js");
  }

  @lazy() get services() {
    // TODO: what is the official logic?
    return this.host
      .globSync(this.pathHelper.api.services + allFilesGlob)
      .filter(followsDirNameConvention)
      .map((x) => new RWService(x, this));
  }

  @lazy() get sdls() {
    return this.host
      .globSync(this.pathHelper.api.graphql + "/**/*.sdl.{js,jsx,ts,tsx}")
      .map((x) => new RWSDL(x, this));
  }

  @lazy() get layouts(): RWLayout[] {
    return this.host
      .globSync(this.pathHelper.web.layouts + allFilesGlob)
      .filter(followsDirNameConvention)
      .filter(isLayoutFileName)
      .map((x) => new RWLayout(x, this));
  }

  @lazy() get functions(): RWFunction[] {
    return this.host
      .globSync(this.pathHelper.api.functions + allFilesGlob)
      .map((x) => new RWFunction(x, this));
  }

  @lazy() get components(): RWComponent[] {
    return this.host
      .globSync(this.pathHelper.web.components + allFilesGlob)
      .filter(followsDirNameConvention)
      .map((x) =>
        isCellFileName(x) ? new RWCell(x, this) : new RWComponent(x, this)
      );
  }
}

export class RWTOML extends FileNode {
  constructor(public filePath: string, public parent: RWProject) {
    super();
  }
  // @lazy() get content(): TOML.JsonMap {
  //   return TOML.parse(this.text)
  // }
  // TODO: diagnostics
}

/**
 * functions exist in the /functions folder
 */
export class RWFunction extends FileNode {
  constructor(public filePath: string, public parent: RWProject) {
    super();
  }
  // TODO: add some checks
  // for example, make sure it exports a handler function
}

/**
 * layouts live in the src/layouts folder
 */
export class RWLayout extends FileNode {
  constructor(public filePath: string, public parent: RWProject) {
    super();
  }
}

export class RWComponent extends FileNode {
  constructor(public filePath: string, public parent: RWProject) {
    super();
  }
  isCell = false;
}

export class RWCell extends RWComponent {
  // TODO: diagnostic: a cell must export certain members...
  isCell = true;
}

export class RWService extends FileNode implements OutlineItem {
  constructor(public filePath: string, public parent: RWProject) {
    super();
  }
  /**
   * the name of this service
   */
  @lazy() get name() {
    return basenameNoExt(this.filePath);
  }

  @lazy() get outlineLabel() {
    return this.name;
  }

  @lazy() get sdl(): RWSDL | undefined {
    return this.parent.sdls.find((sdl) => sdl.name === this.name);
  }

  children() {
    return [...this.funcs];
  }

  @lazy() get funcs() {
    return [...this._funcs()];
  }
  private *_funcs() {
    // export const foo = () => {}
    for (const vd of this.sf.getVariableDeclarations()) {
      if (vd.isExported()) {
        const init = vd.getInitializerIfKind(tsm.SyntaxKind.ArrowFunction);
        if (init)
          yield new RWServiceFunction(vd.getName(), vd.getNameNode(), this);
      }
    }
    // export function foo(){}
    for (const fd of this.sf.getFunctions()) {
      if (fd.isExported() && !fd.isDefaultExport()) {
        const nn = fd.getNameNode();
        if (nn) yield new RWServiceFunction(nn.getText(), nn, this);
      }
    }
  }
}

export class RWServiceFunction extends BaseNode {
  constructor(
    public name: string,
    public node: tsm.Node,
    public parent: RWService
  ) {
    super();
  }

  @lazy() get id() {
    return this.parent.id + " " + this.name;
  }

  /**
   * The SDL field that this function implements, if any
   */
  @lazy() get sdlField(): RWSDLField | undefined {
    return this.parent.sdl?.implementableFields?.find(
      (f) => f.name === this.name
    );
  }
  // TODO: diagnostic: if this function implements an SDL field, make sure parameter names match
}

export class RWSDL extends FileNode {
  constructor(public filePath: string, public parent: RWProject) {
    super();
  }
  /**
   * The Template Literal node (string) that contains the schema
   */
  @lazy() get schemaStringNode() {
    const i = this.sf.getVariableDeclaration("schema")?.getInitializer();
    if (!i) return undefined;
    // TODO: do we allow other kinds of strings? or just tagged literals?
    if (tsm.Node.isTaggedTemplateExpression(i)) {
      const t = i.getTemplate(); //?
      if (tsm.Node.isNoSubstitutionTemplateLiteral(t)) return t;
    }
    return undefined;
  }
  @lazy() get schemaString(): string | undefined {
    return this.schemaStringNode?.getLiteralText();
  }
  @lazy() get serviceFilePath() {
    return this.parent.servicesFilePath(this.name);
  }
  @lazy() get service() {
    return this.parent.services.find((s) => s.name === this.name);
  }
  @lazy() get name() {
    // TODO: support TS
    const base = basename(this.filePath);
    return base.substr(0, base.length - ".sdl.js".length);
  }
  @lazy() get implementableFields() {
    return [...this._implementableFields()];
  }
  private *_implementableFields() {
    if (!this.schemaString) return; //?
    const ast = parseGraphQL(this.schemaString);
    for (const def of ast.definitions)
      if (def.kind === "ObjectTypeDefinition")
        if (def.name.value === "Query" || def.name.value === "Mutation")
          for (const field of def.fields ?? [])
            yield new RWSDLField(def, field, this);
    //JSON.stringify(ast, null, 2) //?
    //const schema = buildSchema(this.schemaString, { assumeValid: true })
  }
  children() {
    return [...this.implementableFields];
  }
  *diagnostics() {
    if (!this.schemaStringNode) {
      yield {
        uri: this.uri,
        diagnostic: {
          range: fullDocRange,
          message:
            "Each SDL file must export a variable named 'schema' with a GraphQL schema string",
          severity: DiagnosticSeverity.Error,
          code: RWError.SCHEMA_NOT_DEFINED,
        },
      } as DiagnosticWithLocation;
    }
  }
}

export class RWSDLField extends BaseNode implements OutlineItem {
  constructor(
    public objectTypeDef: ObjectTypeDefinitionNode,
    public field: FieldDefinitionNode,
    public parent: RWSDL
  ) {
    super();
  }
  @lazy() get id() {
    return (
      this.parent.id + " " + this.objectTypeDef.name.value + "." + this.name
    );
  }
  @lazy() private get location(): Location {
    let { start, end } = this.field.loc!;
    const node = this.parent.schemaStringNode!;
    start += node.getPos() + 1; // we add one to account for the quote (`)
    end += node.getPos() + 1;
    const startPos = offset2position(start, node.getSourceFile());
    const endPos = offset2position(end, node.getSourceFile());
    return { uri: this.parent.uri, range: { start: startPos, end: endPos } };
  }
  @lazy() get name() {
    return this.field.name.value;
  }
  @lazy() get outlineLabel() {
    return this.name;
  }
  @lazy() get outlineAction() {
    return this.location;
  }
  *ideInfo() {
    if (this.impl) {
      yield {
        kind: "Implementation",
        location: this.location,
        target: Location_fromNode(this.impl.node),
      } as Implementation;
    }
  }
  /**
   * TODO: describe in prose what is going on here.
   * this is an important rule
   */
  @lazy() get impl(): RWServiceFunction | undefined {
    return (this.parent.service?.funcs ?? []).find((f) => f.name === this.name);
  }
  // TODO: improve snippet
  @lazy() private get defaultImplSnippet(): string {
    const args = this.field.arguments ?? [];
    const params = args.map((a) => a.name.value).join(",");
    return `
export const ${this.field.name.value} = ({${params}}) => {
  // TODO: implement
}`;
  }

  @lazy() get quickFixAddDefaultImplEdits() {
    const src = this.parent.service?.sf.getText() || ""; // using ?? breaks wallaby.js
    return new Map([
      // KLUDGE: we are adding the implementation at the end of the file. we can do better.
      [this.parent.serviceFilePath, src + "\n\n" + this.defaultImplSnippet],
    ]);
  }

  *diagnostics() {
    if (!this.impl) {
      const { uri, range } = this.location;
      yield {
        uri,
        diagnostic: {
          range,
          message: "Service Not Implemented",
          severity: DiagnosticSeverity.Error,
          code: RWError.SERVICE_NOT_IMPLEMENTED,
        },
        quickFix: () => this.quickFixAddDefaultImplEdits,
      } as DiagnosticWithLocation;
    }
  }
}

export class RWPage extends FileNode implements OutlineItem {
  constructor(
    public const_: string,
    public path: string,
    public parent: RWProject
  ) {
    super();
  }
  @lazy() get filePath() {
    return directoryNameResolver(this.path);
  }
  @lazy() get outlineLabel() {
    return this.basenameNoExt;
  }
  @lazy() get outlineAction() {
    return this.filePath;
  }
  @lazy() get route() {
    return this.parent.router.routes.find(
      (r) => r.page_identifier_str === this.const_
    );
  }
  @lazy() get layoutName(): string | undefined {
    const candidates = this.parent.layouts.map((l) => l.basenameNoExt);
    if (candidates.length === 0) return undefined;
    for (const tag of this.sf.getDescendantsOfKind(
      tsm.SyntaxKind.JsxOpeningElement
    )) {
      const t = tag.getTagNameNode().getText(); //?
      if (candidates.includes(t)) return t;
    }
    return undefined;
  }
  @lazy() get actionRemove() {
    const edits = new Map<any, any>();
    // delete directory (MyPage/...)
    edits.set(dirname(this.filePath), undefined);
    // removing a page also removes its route
    if (this.route) edits.set(this.route.jsxNode, undefined);
    return edits;
  }
  // TODO: parameters
  // if page file is empty, suggest quickfix
}

/**
 * one per Routes.js
 */
export class RWRouter extends FileNode {
  constructor(public filePath: string, public parent: RWProject) {
    super();
  }
  // this is used by the live preview
  @memo() getFilePathForRoutePath(routePath: string): string | undefined {
    // TODO: params
    return this.routes.find((r) => r.path === routePath)?.page?.filePath;
  }
  // this is used by the live preview
  @memo() getRoutePathForFilePath(filePath: string): string | undefined {
    // TODO: params
    const path = this.parent.pages.find((p) => p.filePath === filePath)?.route
      ?.path;
    if (path?.includes("{")) return;
    return path;
  }

  /**
   * the <Router> tag
   */
  @lazy() private get jsxNode() {
    return this.sf
      .getDescendantsOfKind(tsm.SyntaxKind.JsxOpeningElement)
      .find((x) => x.getTagNameNode().getText() === "Router");
  }

  @lazy() get routes() {
    return [...this._routes()];
  }
  private *_routes() {
    for (const x of this.sf.getDescendantsOfKind(
      tsm.SyntaxKind.JsxSelfClosingElement
    )) {
      const tagName = x.getTagNameNode().getText();
      if (tagName === "Route") yield new RWRoute(x, this);
    }
  }
  @lazy() private get numNotFoundPages(): number {
    return this.routes.filter((r) => r.isNotFound).length;
  }
  *ideInfo() {
    // if (this.jsxNode) {
    //   let location = Location_fromNode(this.jsxNode)
    //   if (this.routes.length > 0) {
    //     location = Location_fromNode(this.routes[0].jsxNode)
    //     yield { kind: 'CodeLens', location, text: 'Add Page' } as CodeLens
    //   }
    // }
  }
  *diagnostics() {
    // can a Router have zero notfound pages?
    // TODO: add quickfix for this one
    // if there are no notfound pages, create one
    if (this.numNotFoundPages !== 1) {
      if (this.jsxNode)
        yield err(
          this.jsxNode,
          "You must specify exactly one 'notfound' page",
          RWError.NOTFOUND_PAGE_NOT_DEFINED
        );
    }
  }
  children() {
    return [...this.routes];
  }
}

export class RWRoute extends BaseNode implements OutlineItem {
  constructor(
    /**
     * the <Route> tag
     */
    public jsxNode: tsm.JsxSelfClosingElement,
    public parent: RWRouter
  ) {
    super();
  }

  @lazy() get id() {
    // we cannot rely on the "path" attribute of the node
    // it might not be unique (which is an error state, but valid while editing)
    return this.parent.id + " " + this.jsxNode.getStart();
  }

  @lazy() get isAuthenticated() {
    return false; // TODO
  }

  @lazy() get outlineLabel(): string {
    if (this.isNotFound) return "404";
    return this.path ?? "";
  }

  @lazy() get outlineDescription(): string | undefined {
    const fp = this.page?.filePath;
    if (!fp) return undefined;
    return basename(fp);
  }

  @lazy() get outlineAction() {
    // navigate to the JSX Node
    return Location_fromNode(this.jsxNode);
  }

  @lazy() get outlineIcon() {
    return this.isAuthenticated ? "route-private" : "route";
  }

  /**
   * The associated Redwood Page node, if any
   */
  @lazy() get page() {
    if (!this.page_identifier_str) return undefined;
    return this.parent.parent.pages.find(
      (p) => p.const_ === this.page_identifier_str
    );
  }
  /**
   * <Route path="" page={THIS_IDENTIFIER}/>
   */
  @lazy() private get page_identifier(): tsm.Identifier | undefined {
    const a = this.jsxNode.getAttribute("page");
    if (!a) return undefined;
    if (tsm.Node.isJsxAttribute(a)) {
      const init = a.getInitializer();
      if (tsm.Node.isJsxExpression(init!)) {
        const expr = init.getExpression();
        if (tsm.Node.isIdentifier(expr!)) {
          return expr;
        }
      }
    }
    return undefined;
  }
  @lazy() get page_identifier_str(): string | undefined {
    return this.page_identifier?.getText();
  }
  @lazy() get name(): string | undefined {
    return this.getStringAttr("name");
  }
  @lazy() get path_errorMessage(): string | undefined {
    // TODO: path validation is not strong enough
    if (typeof this.path === "undefined") return undefined;
    try {
      validatePath(this.path);
      return undefined;
    } catch (e) {
      return e.toString();
    }
  }
  @lazy() get path(): string | undefined {
    return this.getStringAttr("path");
  }
  @lazy() get path_literal_node() {
    const a = this.jsxNode.getAttribute("path");
    if (!a) return undefined;
    if (tsm.Node.isJsxAttribute(a)) {
      const init = a.getInitializer();
      if (tsm.Node.isStringLiteral(init!)) {
        return init;
      }
    }
    return undefined;
  }

  @lazy() get isNotFound(): boolean {
    return typeof this.jsxNode.getAttribute("notfound") !== "undefined";
  }

  *diagnostics() {
    if (this.page_identifier && !this.page)
      // normally this would be caught by TypeScript
      // but Redwood has some "magic" import behavior going on
      yield err(this.page_identifier, "Page component not found");
    if (this.path_errorMessage && this.path_literal_node)
      yield err(
        this.path_literal_node,
        this.path_errorMessage,
        RWError.INVALID_ROUTE_PATH_SYNTAX
      );
    if (this.hasPathCollision)
      yield err(this.path_literal_node!, "Duplicate Path");
    if (this.isAuthenticated && this.isNotFound)
      yield err(this.jsxNode!, "The 'Not Found' page cannot be authenticated");
    if (this.isNotFound && this.path)
      yield err(
        this.path_literal_node!,
        "The 'Not Found' page cannot have a path"
      );
  }
  *ideInfo() {
    // definition: page identifier --> page
    if (this.page && this.page_identifier) {
      yield {
        kind: "Definition",
        location: Location_fromNode(this.page_identifier),
        target: Location_fromFilePath(this.page.filePath),
      } as Definition;
    }
    if (this.path && this.page) {
      // const location = Location_fromNode(this.jsxNode!)
      // yield { kind: 'Hover', location, text: 'Open Preview' } as Hover
      // TODO: preview
    }
  }

  @lazy() private get hasPathCollision() {
    if (!this.path) return false;
    const pathWithNoParamNames = removeParamNames(this.path);
    for (const route2 of this.parent.routes) {
      if (route2 === this) continue;
      if (!route2.path) continue;
      if (removeParamNames(route2.path) === pathWithNoParamNames) return true;
    }
    return false;
    function removeParamNames(p: string) {
      // TODO: implement
      // foo/{bar}/baz --> foo/{}/baz
      return p;
    }
  }

  private getStringAttr(name: string) {
    const a = this.jsxNode.getAttribute(name);
    if (!a) return undefined;
    if (tsm.Node.isJsxAttribute(a)) {
      const init = a.getInitializer();
      if (tsm.Node.isStringLiteral(init!)) return init.getLiteralValue();
    }
    return undefined;
  }
}
