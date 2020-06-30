import { resolve } from "path";
import { RWProject } from "../core/RWProject";
import { DefaultHost } from "../ide";
import { findOutlineItemForFile, getOutline, outlineToJSON } from "../outline";

describe("outline", () => {
  it("example-todo-master", async () => {
    const projectRoot = resolve(
      __dirname,
      "../../fixtures/example-todo-master"
    );
    const project = new RWProject({ projectRoot, host: new DefaultHost() });
    const outline = getOutline(project);
    outline; //?
    const fileURI = `file://${projectRoot}/web/src/components/AddTodoControl/AddTodoControl.js`;
    const res = await findOutlineItemForFile(fileURI, outline);
    expect(res).toBeDefined();
    expect(res!.link).toEqual(fileURI);
    const outline2 = await outlineToJSON(outline);
    JSON.stringify(outline2, null, 2); //?
  });
});
