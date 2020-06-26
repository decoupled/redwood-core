import { basename, resolve } from "path";
import { DefaultHost } from "../ide";
import { RWProject } from "../project";
import { getOutline, findOutlineItemForFile, outlineToJSON } from "../outline";

describe("redwood project", () => {
  it("example-todo-master", async () => {
    const projectRoot = resolve(
      __dirname,
      "../../fixtures/example-todo-master"
    );
    const project = new RWProject({ projectRoot, host: new DefaultHost() });
    const outline = getOutline(project);
    outline; //?
    const fileURI =
      "file:///Users/aldo/com.github/decoupled/redwood-core/fixtures/example-todo-master/web/src/components/AddTodoControl/AddTodoControl.js";
    const res = await findOutlineItemForFile(fileURI, outline);
    expect(res).toBeDefined();
    expect(res!.link).toEqual(fileURI);

    const outline2 = await outlineToJSON(outline);
    JSON.stringify(outline2, null, 2); //?
  });
});
