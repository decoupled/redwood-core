import { DefaultHost, DiagnosticWithLocation, Host, OutlineItem } from "./ide";
import { RWProject } from "./project";

export async function getDiagnostics(
  projectRoot: string,
  filePath?: string | undefined,
  host: Host = new DefaultHost()
): Promise<DiagnosticWithLocation[]> {
  const project = new RWProject({ projectRoot, host });
  if (!filePath) return await project.getAllDiagnostics();
  const node = await project.findNode(filePath);
  if (node)
    return (await node.getAllDiagnostics()).filter(
      (d) => d.uri === `file://${filePath}`
    );
  return [];
}

// TODO
export async function getOutline(
  projectRoot: string,
  host: Host = new DefaultHost()
): Promise<OutlineItem> {
  return new RWProject({ projectRoot, host });
}
