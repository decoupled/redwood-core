import { FileNode } from "../ide";
import { RWProject } from "./RWProject";
/**
 * functions exist in the /functions folder
 */
export class RWFunction extends FileNode {
  constructor(public filePath: string, public parent: RWProject) {
    super();
  }
}
