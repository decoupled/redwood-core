import { basename } from "path";
import { basenameNoExt } from "./ide";
import { parse } from 'graphql'

export function directoryNameResolver(dirName: string) {
  const parts = dirName.split("/");
  const pp = parts[parts.length - 1];
  parts.push(pp);
  return parts.join("/") + ".js";
}

export function followsDirNameConvention(filePath: string) {
  const ending = basenameNoExt(filePath) + "/" + basename(filePath);
  return filePath.endsWith(ending);
}

export function isLayoutFileName(f: string) {
  return basenameNoExt(f).endsWith("Layout");
}

export function isCellFileName(f: string) {
  return basenameNoExt(f).endsWith("Cell");
}

export function validatePath(path: string) {
  // copied from https://github.com/redwoodjs/redwood/blob/master/packages/router/src/util.js
  // Check that path begins with a slash.
  if (!path.startsWith("/")) {
    throw new Error(`Route path does not begin with a slash: "${path}"`);
  }

  if (path.indexOf(" ") >= 0) {
    throw new Error(`Route path contains spaces: "${path}"`);
  }

  // Check for duplicate named params.
  const matches = path.matchAll(/\{([^}]+)\}/g);
  const memo: any = {};
  for (const match of matches) {
    // Extract the param's name to make sure there aren't any duplicates
    const param = match[1].split(":")[0];
    if (memo[param]) {
      throw new Error(`Route path contains duplicate parameter: "${path}"`);
    } else {
      memo[param] = true;
    }
  }
}

export function graphQLSourceToAST(source: string) {
  return parse(source) //?
}
