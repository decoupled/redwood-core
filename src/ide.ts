import * as fs from "fs-extra";
import glob from "glob";
import { LazyGetter as lazy } from "lazy-get-decorator";
import { Memoize as memo } from "lodash-decorators";
import { basename } from "path";
import * as tsm from "ts-morph";
import {
  Diagnostic,
  DiagnosticSeverity,
  DocumentUri,
  Location,
  Position,
  Range,
} from "vscode-languageserver-types";

export type NodeID = string;

export interface Host {
  existsSync(path: string): boolean;
  readFileSync(path: string): string;
  readdirSync(path: string): string[];
  globSync(pattern: string): string[];
}

export type IDEInfo =
  | Definition
  | Implementation
  | Reference
  | CodeLens
  | Hover;

export interface Definition {
  kind: "Definition";
  location: Location;
  target: Location;
}

export interface Implementation {
  kind: "Implementation";
  location: Location;
  target: Location;
}

export interface Reference {
  kind: "Reference";
  location: Location;
  target: Location;
}

export interface CodeLens {
  kind: "CodeLens";
  location: Location;
  text: string;
}

export interface Hover {
  kind: "Hover";
  location: Location;
  text: string;
}

/**
 * The Diagnostic interface defined in vscode-languageserver-types
 * does not include the document URI.
 * This interface adds that, and a few other things.
 */
export interface ExtendedDiagnostic {
  uri: DocumentUri;
  diagnostic: Diagnostic;
  /**
   * A function that returns a quickfix associated to this diagnostic.
   */
  quickFix?: () => Promise<QuickFix>;
}

export type QuickFix = QuickFixEdits | CLICommand;

/**
 * A very simple representation of a quickfix that changes files
 * filePath --> newContent | undefined
 * undefined will remove the file
 */
export type QuickFixEdits = Map<string, string | undefined>;

export type CLICommand = string;

export interface OutlineItem {
  /**
   * Label for the outline item.
   * This is the main text.
   */
  outlineLabel: string;
  /**
   * Secondary text.
   */
  outlineDescription?: string;
  /**
   * Each node must have a unique ID.
   */
  id: string;
  /**
   *
   */
  // outlineIcon?: OutlineIcon;
  outlineTooltip?: string;
  /**
   * What to do when the item is clicked/navigated to
   * - Passing a FilePath or a Location will result in the IDE navigating
   * - A CLIAction (string) will call the Redwood CLI
   */
  outlineAction?: Action;
  /**
   * - If present, this item will be rendered as a folder (with an expand button).
   * - If undefined, this item will be rendered as a leaf
   */
  outlineChildren?: Promise<OutlineItem[]> | OutlineItem[];
}

export type Action = DocumentUri | Location | CLIAction | (() => {});

// export type OutlineIcon =
//   | "redwood"
//   | "netlify"
//   | "page"
//   | "page-private"
//   | "route"
//   | "route-private";

/**
 * A command to send the redwood CLI
 * ex: "generate page"
 */
export type CLIAction = string;

export type Many<T> =
  | T[]
  | Promise<T[]>
  | IterableIterator<T>
  | undefined
  | void
  | null;

export async function Many_normalize<T>(x: Many<T>): Promise<T[]> {
  if (x instanceof Promise) return x;
  if (x === null) return [];
  if (typeof x === "undefined") return [];
  return [...x];
}

export async function OutlineItems_toJSON(items: OutlineItem[]) {
  return Promise.all(items.map(OutlineItem_toJSON));
}

export async function OutlineItem_toJSON(item: OutlineItem) {
  const data: any = {
    outlineLabel: item.outlineLabel,
    outlineDescription: item.outlineDescription,
    id: item.id,
    // outlineIcon: item.outlineIcon,
    outlineTooltip: item.outlineTooltip,
    outlineAction: item.outlineAction,
  };
  const c = item.outlineChildren;
  if (c) {
    const v = c instanceof Promise ? await c : c;
    data.outlineChildren = await OutlineItems_toJSON(v);
  }
  return data;
}

export abstract class BaseNode {
  /**
   * Each node MUST have a unique ID.
   * IDs have meaningful information.
   *
   * examples:
   * - /path/to/project
   * - /path/to/project/web/src/Routes.js
   * - /path/to/project/web/src/Routes.js /route1
   */
  abstract id: NodeID;
  abstract parent: BaseNode | undefined;

  @lazy()
  get host(): Host {
    if (this.parent) return this.parent.host;
    throw new Error(
      "Could not find host implementation on root node (you must override the 'host' gettter)"
    );
  }
  exists = true;
  /**
   * Returns the children of this node.
   * Override this.
   */
  children(): Many<BaseNode> {
    return [];
  }
  @memo() private _children() {
    return Many_normalize(this.children());
  }

  /**
   * Diagnostics for this node (must not include children's diagnostics).
   * Override this.
   */
  diagnostics(): Many<ExtendedDiagnostic> {
    return [];
  }
  @memo() private _diagnostics() {
    return Many_normalize(this.diagnostics());
  }

  ideInfo(): Many<IDEInfo> {
    return [];
  }

  /**
   * Collects diagnostics for this node and all descendants.
   * This is what you'll use to gather all the project diagnostics.
   */
  @memo()
  async getAllDiagnostics(): Promise<ExtendedDiagnostic[]> {
    // TODO: catch runtime errors and add them as diagnostics
    const d1 = await this._diagnostics();
    const dd = await Promise.all(
      (await this._children()).map((c) => c.getAllDiagnostics())
    );
    const d2 = dd.flat();
    return [...d1, ...d2];
  }

  /**
   * Finds a node by ID.
   * The default algorithm tries to be economic and only create the necessary
   * intermediate nodes.
   * Subclasses can override this to add further optimizations.
   * @param id
   */
  @memo()
  async findNode(id: NodeID): Promise<BaseNode | undefined> {
    if (this.id === id) return this;
    if (id.startsWith(this.id))
      for (const c of await this._children()) {
        // depth first search by default
        const cc = await c.findNode(id);
        if (cc) return cc;
      }
    return undefined;
  }
}

export abstract class FileNode extends BaseNode {
  abstract filePath: string;
  @lazy() get uri(): string {
    return `file://${this.filePath}`;
  }
  /**
   * the ID of a FileNode is its path.
   */
  @lazy() get id() {
    return this.filePath;
  }
  @lazy() get text() {
    return this.host.readFileSync(this.filePath);
  }
  /**
   * parsed ts-morph source file
   */
  @lazy() get sf(): tsm.SourceFile {
    if (typeof this.text === "undefined")
      throw new Error("undefined file " + this.filePath);
    return createTSMSourceFile(this.filePath, this.text!);
  }
  @lazy() get basenameNoExt() {
    return basenameNoExt(this.filePath);
  }
}

export function createTSMSourceFile(
  filePath: string,
  src: string
): tsm.SourceFile;
export function createTSMSourceFile(src: string): tsm.SourceFile;
/**
 * Creates a cheap in-memory ts-morph source file
 * @param a1
 * @param a2
 */
export function createTSMSourceFile(a1: string, a2?: string): tsm.SourceFile {
  let [filePath, src] = [a1, a2];
  if (!a2) {
    src = filePath;
    filePath = "/file.tsx";
  }
  return new tsm.Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    compilerOptions: {
      skipLibCheck: true,
      noLib: true,
      skipDefaultLibCheck: true,
      noResolve: true,
    },
  }).createSourceFile(filePath, src);
}

export function basenameNoExt(path: string) {
  const parts = basename(path).split(".");
  if (parts.length > 1) parts.pop();
  return parts.join(".");
}

export class DefaultHost implements Host {
  existsSync(path: string) {
    return fs.existsSync(path);
  }
  readFileSync(path: string) {
    return fs.readFileSync(path, { encoding: "utf8" }).toString();
  }
  readdirSync(path: string) {
    return fs.readdirSync(path);
  }
  globSync(pattern: string) {
    return glob.sync(pattern);
  }
}

export function Range_fromNode(node: tsm.Node): Range {
  const start = offset2position(node.getStart(false), node.getSourceFile());
  const end = offset2position(node.getEnd(), node.getSourceFile());
  return { start, end };
}

export function Location_fromNode(node: tsm.Node): Location {
  return {
    uri: "file://" + node.getSourceFile().getFilePath(),
    range: Range_fromNode(node),
  };
}

export function Location_fromFilePath(filePath: string): Location {
  return { uri: `file://${filePath}`, range: Range.create(0, 0, 0, 0) };
}

/**
 * Helper method to create a DiagnosticWithLocation from a ts-morph Node and an error message
 * @param node
 * @param message
 */
export function err(
  node: tsm.Node,
  message: string,
  code?: number | string
): ExtendedDiagnostic {
  return {
    uri: `file://${node.getSourceFile().getFilePath()}`,
    diagnostic: {
      range: Range_fromNode(node),
      message,
      severity: DiagnosticSeverity.Error,
      code,
    },
  };
}

/**
 * Helper method to create a DiagnosticWithLocation from a ts-morph Node and a warning message
 * @param node
 * @param message
 */
export function warn(node: tsm.Node, message: string): ExtendedDiagnostic {
  return {
    uri: `file://${node.getSourceFile().getFilePath()}`,
    diagnostic: {
      range: Range_fromNode(node),
      message,
      severity: DiagnosticSeverity.Warning,
    },
  };
}

export function offset2position(offset: number, sf: tsm.SourceFile): Position {
  const { line, column } = sf.getLineAndColumnAtPos(offset);
  return { character: column, line };
}
