import { LazyGetter as lazy } from "lazy-get-decorator";
import { parse as parseTOML } from "toml";
import { Range } from "vscode-languageserver-types";
import { FileNode } from "../ide";
import { err } from "../x/vscode-languageserver-types";
import { RWProject } from "./RWProject";

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
