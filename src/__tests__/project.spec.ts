import { resolve } from "path";
import { DefaultHost, OutlineItems_toJSON } from "../ide";
import { RWProject } from "../project";
import { RWError } from "../errors";

describe("redwood project", () => {
  it("example-todo-master", async () => {
    const projectRoot = resolve(
      __dirname,
      "../../fixtures/example-todo-master"
    );
    const project = new RWProject({ projectRoot, host: new DefaultHost() });

    const pageNames = new Set(project.pages.map((p) => p.basenameNoExt));
    expect(pageNames).toEqual(
      new Set(["FatalErrorPage", "HomePage", "NotFoundPage"])
    );
    for (const page of project.pages) {
      page.basenameNoExt; //?
      page.route?.id; //?
    }
    project.components.length; //?
    project.components.map((c) => c.basenameNoExt); //?
    project.functions.length; //?
    project.services.length; //?
    project.sdls.length; //?
    project.outlineLabel; //?
    const outline = await OutlineItems_toJSON([project]);
    JSON.stringify(outline, null, 2); //?
    const ds = await project.getAllDiagnostics();
    ds.length; //?
  });

  it("example-todo-master-with-errors", async () => {
    const projectRoot = resolve(
      __dirname,
      "../../fixtures/example-todo-master-with-errors"
    );
    const project = new RWProject({ projectRoot, host: new DefaultHost() });
    const ds = await project.getAllDiagnostics();
    ds.length; //?
    const diagnosticCodes = new Set(ds.map((d) => d.diagnostic.code));
    expect(diagnosticCodes).toEqual(
      new Set([RWError.NOTFOUND_PAGE_NOT_DEFINED])
    );
  });
});
