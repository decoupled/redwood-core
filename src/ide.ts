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
  DiagnosticRelatedInformation,
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
    // TODO: we can parallelize this further
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
  @lazy() get fileExists(): boolean {
    return this.host.existsSync(this.filePath);
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

export function LocationLike_toLink(loc: LocationLike): string {
  const {
    uri,
    range: {
      start: { line, character },
    },
  } = LocationLike_toLocation(loc);
  return `${uri}:${line}:${character}`;
}

export type LocationLike = tsm.Node | string | Location | ExtendedDiagnostic;

export function LocationLike_toLocation(x: LocationLike): Location {
  if (typeof x === "string") {
    if (x.startsWith("/")) x = "file://" + x;
    return { uri: x, range: Range.create(0, 0, 0, 0) };
  }
  if (typeof x === "object") {
    if (x instanceof tsm.Node) return Location_fromNode(x);
    if (isLocation(x)) return x;
    if (isExtendedDiagnostic(x))
      return { uri: x.uri, range: x.diagnostic.range };
  }
  throw new Error();
}

export function isLocation(x: any): x is Location {
  if (typeof x !== "object") return false;
  if (typeof x.uri !== "string") return false;
  if (!isRange(x.range)) return false;
  return true;
}

export function isExtendedDiagnostic(x: any): x is ExtendedDiagnostic {
  if (typeof x !== "object") return false;
  if (typeof x.uri !== "string") return false;
  if (!isDiagnostic(x.diagnostic)) return false;
  return true;
}

export function isDiagnostic(x: any): x is Diagnostic {
  // TODO: improve checks
  if (typeof x !== "object") return false;
  if (typeof x.message !== "string") return false;
  if (!isRange(x.range)) return false;
  return true;
}

export function isRange(x: any): x is Range {
  if (typeof x !== "object") return false;
  if (!isPosition(x.start)) return false;
  if (!isPosition(x.end)) return false;
  return true;
}

export function isPosition(x: any): x is Position {
  if (typeof x !== "object") return false;
  if (typeof x.line !== "number") return false;
  if (typeof x.character !== "number") return false;
  return true;
}

/**
 * Helper method to create diagnostics
 * @param node
 * @param message
 */
export function err(
  loc: LocationLike,
  message: string,
  code?: number | string
): ExtendedDiagnostic {
  const { uri, range } = LocationLike_toLocation(loc);
  return {
    uri,
    diagnostic: {
      range,
      message,
      severity: DiagnosticSeverity.Error,
      code,
    },
  };
}

export function offset2position(offset: number, sf: tsm.SourceFile): Position {
  const { line, column } = sf.getLineAndColumnAtPos(offset);
  return { character: column, line };
}

export function nudgeDiagnostic(d: Diagnostic, offset: number) {
  let { range, relatedInformation, ...rest } = d;
  range = nudgeRange(range, offset);
  if (relatedInformation)
    relatedInformation = relatedInformation.map((x) =>
      nudgeDiagnosticRelatedInformation(x, offset)
    );
  return { ...rest, relatedInformation, range };
}

function nudgeDiagnosticRelatedInformation(
  d: DiagnosticRelatedInformation,
  offset: number
): DiagnosticRelatedInformation {
  let {
    location: { uri, range },
    message,
  } = d;
  range = nudgeRange(range, offset);
  return { location: { uri, range }, message };
}

function nudgeRange(r: Range, offset: number): Range {
  return {
    start: nudgePosition(r.start, offset),
    end: nudgePosition(r.end, offset),
  };
}
function nudgePosition(p: Position, offset: number): Position {
  const pp = { line: p.line + offset, character: p.character + offset };
  if (pp.line < 0) pp.line = 0;
  if (pp.character < 0) pp.character = 0;
  return pp;
}
