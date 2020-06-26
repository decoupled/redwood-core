import { getDMMF } from "@prisma/sdk";
// TODO: re-implement a higher quality version of these in ./project
import { getPaths, processPagesDir } from "@redwoodjs/internal/dist/paths";
import {
  FieldDefinitionNode,
  ObjectTypeDefinitionNode,
} from "graphql/language/ast";
import { parse as parseGraphQL } from "graphql/language/parser";
import { LazyGetter as lazy } from "lazy-get-decorator";
import { Memoize as memo } from "lodash-decorators";
import { basename, dirname, join } from "path";
import { parse as parseTOML } from "toml";
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
  err,
  ExtendedDiagnostic,
  FileNode,
  Host,
  Implementation,
  Location_fromFilePath,
  Location_fromNode,
  offset2position,
  Range_fromNode,
  LocationLike_toLocation,
  LocationLike_toLink,
} from "./ide";
import {
  directoryNameResolver,
  followsDirNameConvention,
  isCellFileName,
  isLayoutFileName,
  validatePath,
  graphQLSourceToAST,
} from "./util";

export interface RWProjectOptions {
  projectRoot: string;
  host: Host;
}

const allFilesGlob = "/**/*.{js,jsx,ts,tsx}";

/**
 * Represents a Redwood project.
 * This is the root node.
 */
export class RWProject extends BaseNode {
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

  children() {
    return [
      this.redwoodTOML,
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
  @memo() async prismaDMMF() {
    return await getDMMF({
      datamodel: this.host.readFileSync(this.pathHelper.api.dbSchema),
    });
  }
  @memo() async prismaDMMFModelNames() {
    return (await this.prismaDMMF()).datamodel.models.map((m) => m.name);
  }
  @lazy() get redwoodTOML(): RWTOML {
    return new RWTOML(join(this.projectRoot, "redwood.toml"), this);
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
    // TODO: Support both `/services/todos/todos.js` AND `/services/todos.js`
    return this.host
      .globSync(this.pathHelper.api.services + allFilesGlob)
      .filter(followsDirNameConvention)
      .map((x) => new RWService(x, this));
  }

  @lazy() get sdls() {
    return this.host
      .globSync(this.pathHelper.api.graphql + "/**/*.sdl.{js,ts}")
      .map((x) => new RWSDL(x, this));
  }

  @lazy() get layouts(): RWLayout[] {
    // TODO: what is the official logic?
    return this.host
      .globSync(this.pathHelper.web.layouts + allFilesGlob)
      .filter(followsDirNameConvention)
      .filter(isLayoutFileName)
      .map((x) => new RWLayout(x, this));
  }

  @lazy() get functions(): RWFunction[] {
    // TODO: what is the official logic?
    return this.host
      .globSync(this.pathHelper.api.functions + allFilesGlob)
      .map((x) => new RWFunction(x, this));
  }

  @lazy() get components(): RWComponent[] {
    return this.host
      .globSync(this.pathHelper.web.components + allFilesGlob)
      .map((file) => {
        if (isCellFileName(file)) {
          const possibleCell = new RWCell(file, this);
          return possibleCell.isCell
            ? possibleCell
            : new RWComponent(file, this);
        }
        return new RWComponent(file, this);
      });
  }

  /**
   * A "Cell" is a component that ends in `Cell.{js, jsx, tsx}`, but does not
   * have a default export AND does not export `QUERY`
   **/
  @lazy() get cells(): RWCell[] {
    return this.host
      .globSync(this.pathHelper.web.components + "/**/*Cell.{js,jsx,tsx}")
      .map((file) => new RWCell(file, this))
      .filter((file) => file.isCell);
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
  @lazy() get parsedTOML() {
    return parseTOML(this.text);
  }
  *diagnostics() {
    try {
      this.parsedTOML;
    } catch (e) {
      const pos = { line: e.line, character: e.column };
      const range = Range.create(pos, pos);
      yield err({ uri: this.uri, range }, "TOML Parser Error: " + e.message);
      return;
    }
    // at this point we know that the TOML was parsed successfully
    this.parsedTOML; //?
    const allowedTopElements = ["web", "api"];
    // TODO: check that schema is correct
  }
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

  @lazy() get hasDefaultExport(): boolean {
    // TODO: Is this enough to test a default export?
    return (
      this.sf.getDescendantsOfKind(tsm.SyntaxKind.ExportAssignment).length > 0
    );
  }

  @lazy() get exportedSymbols() {
    // KLUDGE!
    const ss = new Set<string>();
    for (const d of this.sf.getDescendantsOfKind(
      tsm.SyntaxKind.VariableDeclaration
    ))
      if (d.isExported()) ss.add(d.getName());
    return ss;
  }
}

export class RWCell extends RWComponent {
  /**
   * A "Cell" is a component that ends in `Cell.{js, jsx, tsx}`, but does not
   * have a default export AND does not export `QUERY`
   **/
  @lazy() get isCell() {
    return !this.hasDefaultExport && this.exportedSymbols.has("QUERY");
  }

  *diagnostics() {
    // check that QUERY and Success are exported
    if (!this.exportedSymbols.has("QUERY")) {
      yield err(
        this.uri,
        "Every Cell MUST export a QUERY variable (GraphQL query string)"
      );
    }

    // TODO: This could very likely be added into RWCellQUERY
    for (const d of this.sf.getDescendantsOfKind(
      tsm.SyntaxKind.VariableDeclaration
    )) {
      if (d.isExported() && d.getName() === "QUERY") {
        // Check that exported QUERY is syntactically valid GraphQL.
        const gqlNode = d
          .getDescendantsOfKind(tsm.SyntaxKind.TaggedTemplateExpression)[0]
          .getChildAtIndex(1);
        const gqlText = gqlNode.getText().replace(/\`/g, "");
        try {
          graphQLSourceToAST(gqlText);
        } catch (e) {
          // TODO: Make this point to the exact location included in the error.
          yield {
            uri: this.uri,
            diagnostic: {
              range: Range_fromNode(gqlNode),
              message: e.message,
              severity: DiagnosticSeverity.Error,
            },
          } as ExtendedDiagnostic;
        }
      }
    }
    // TODO: check that exported QUERY is semantically valid GraphQL (fields exist)
    if (!this.exportedSymbols.has("Success")) {
      yield err(
        this.uri,
        "Every Cell MUST export a Success variable (React Component)"
      );
    }
  }
}

export class RWService extends FileNode {
  constructor(public filePath: string, public parent: RWProject) {
    super();
  }
  /**
   * The name of this service:
   * services/todos/todos.js --> todos
   */
  @lazy() get name() {
    return basenameNoExt(this.filePath);
  }

  /**
   * Returns the SDL associated with this service (if any).
   * Match is performed by name.
   */
  @lazy() get sdl(): RWSDL | undefined {
    return this.parent.sdls.find((sdl) => sdl.name === this.name);
  }

  children() {
    return [...this.funcs];
  }

  /**
   * All the exported functions declared in this service file.
   * They can be both ArrowFunctions (with name) or FunctionDeclarations (with name)
   */
  @lazy() get funcs() {
    const self = this;
    return iter(function* () {
      // export const foo = () => {}
      for (const vd of self.sf.getVariableDeclarations()) {
        if (vd.isExported()) {
          const init = vd.getInitializerIfKind(tsm.SyntaxKind.ArrowFunction);
          if (init) yield new RWServiceFunction(vd.getName(), init, self);
        }
      }
      // export function foo(){}
      for (const fd of self.sf.getFunctions()) {
        if (fd.isExported() && !fd.isDefaultExport()) {
          const nn = fd.getNameNode();
          if (nn) yield new RWServiceFunction(nn.getText(), fd, self);
        }
      }
    });
  }
}

export class RWServiceFunction extends BaseNode {
  constructor(
    public name: string,
    public node: tsm.FunctionDeclaration | tsm.ArrowFunction,
    public parent: RWService
  ) {
    super();
  }

  @lazy() get id() {
    // This is a compound ID (because it points to an internal node - one within a file)
    return this.parent.id + " " + this.name;
  }

  /**
   * The SDL field that this function implements, if any
   * TODO: describe this in prose.
   */
  @lazy() get sdlField(): RWSDLField | undefined {
    return this.parent.sdl?.implementableFields?.find(
      (f) => f.name === this.name
    );
  }

  @lazy() get parameterNames() {
    const self = this;
    return iter(function* () {
      for (const p of self.node.getParameters()) {
        const nn = p.getNameNode();
        if (nn instanceof tsm.ObjectBindingPattern) {
          for (const element of nn.getElements()) {
            yield element.getNameNode().getText();
          }
        }
        // TODO: handle other cases
      }
    });
  }

  *diagnostics() {
    if (this.sdlField) {
      // this service function is implementing a field
      // parameter names should match
      const p1 = this.sdlField.argumentNames.sort().join(" "); //?
      const p2 = this.parameterNames.sort().join(" "); //?
      if (p1 !== p2) {
        const locationNode = this.node.getParameters()[0] ?? this.node;
        const { uri, range } = Location_fromNode(locationNode);
        const message = `Parameter mismatch between SDL and implementation ("${p1}" !== "${p2}")`;
        yield {
          uri,
          diagnostic: {
            range,
            message,
            severity: DiagnosticSeverity.Error,
            // add related information so developers can jump to the SDL definition
            relatedInformation: [
              {
                location: this.sdlField.location,
                message: "SDL field is defined here",
              },
            ],
          },
        } as ExtendedDiagnostic;
      }

      // TODO: check that types match
      // to do this it is probably easier to leverage a graphql code generator and the typescript compiler
      // the trick is to create a source file with an interface assignment that will fail if there is a mismatch
      // we then simpy "bubble up" the type errors from the typescript compiler
    }
  }
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
    const self = this;
    return iter(function* () {
      if (!self.schemaString) return; //?
      const ast = parseGraphQL(self.schemaString);
      for (const def of ast.definitions)
        if (def.kind === "ObjectTypeDefinition")
          if (def.name.value === "Query" || def.name.value === "Mutation")
            for (const field of def.fields ?? [])
              yield new RWSDLField(def, field, self);
    });
  }

  children() {
    return [...this.implementableFields];
  }
  *diagnostics() {
    if (!this.schemaStringNode) {
      yield err(
        this.uri,
        "Each SDL file must export a variable named 'schema' with a GraphQL schema string",
        RWError.SCHEMA_NOT_DEFINED
      );
    }
  }
}

export class RWSDLField extends BaseNode {
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
  /**
   * The location of this field.
   * Calculating this is slightly complicated since it is embedded within a TaggedTemplateLiteral
   */
  @lazy() get location(): Location {
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
  @lazy() get argumentNames() {
    return (this.field.arguments ?? []).map((a) => a.name.value);
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
        quickFix: async () => this.quickFixAddDefaultImplEdits,
      } as ExtendedDiagnostic;
    }
  }
}

export class RWPage extends FileNode {
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
    // TODO: we need to transform this edits map to a standard edits map (with locations)
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

  /**
   * One per <Route>
   */
  @lazy() get routes() {
    const self = this;
    return iter(function* () {
      if (!self.jsxNode) return;
      // TODO: make sure that they are nested within the <Router> tag
      // we are not checking it right now
      for (const x of self.sf.getDescendantsOfKind(
        tsm.SyntaxKind.JsxSelfClosingElement
      )) {
        const tagName = x.getTagNameNode().getText();
        if (tagName === "Route") yield new RWRoute(x, self);
      }
    });
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
    if (!this.fileExists) {
      // should we assign this error to the project? to redwood.toml?
      const uri = `file://${this.parent.projectRoot}/redwood.toml`;
      const message = `Routes.js does not exist`;
      yield err(uri, message);
      // TODO: add quickFix (create a simple Routes.js)
      return; // stop checking for errors if the file doesn't exist
    }

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

export class RWRoute extends BaseNode {
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

  @lazy() get location(): Location {
    return LocationLike_toLocation(this.jsxNode);
  }

  @lazy() get isAuthenticated() {
    return false; // TODO
  }

  @lazy() get hasParameters(): boolean {
    if (!this.path) return false;
    // KLUDGE: we need a good path parsing library here
    return this.path.includes("{");
  }

  @lazy() get hasPreRenderInfo() {
    // TODO: this is just a placeholder / reminder
    return false;
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

  @lazy() get outlineLink(): string {
    return LocationLike_toLink(this.location);
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
    if (this.hasPreRenderInfo && !this.hasParameters)
      yield err(
        this.jsxNode!, // TODO: point to the preRender attribute AST node
        `Only routes with parameters can have associated pre-render information`
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

function iter<T>(f: () => IterableIterator<T>) {
  return Array.from(f());
}
