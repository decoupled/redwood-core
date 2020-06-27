import { DefaultHost, ExtendedDiagnostic, Host } from "./ide";
import { RWProject } from "./project";

export async function getDiagnostics(
  projectRoot: string,
  filePath?: string | undefined,
  host: Host = new DefaultHost()
): Promise<ExtendedDiagnostic[]> {
  const project = new RWProject({ projectRoot, host });
  if (!filePath) return await project.collectDiagnostics();
  const node = await project.findNode(filePath);
  if (node)
    return (await node.collectDiagnostics()).filter(
      (d) => d.uri === `file://${filePath}`
    );
  return [];
}

export async function printDiagnostics() {}
