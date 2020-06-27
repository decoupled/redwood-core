import * as tsm from "ts-morph";
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
