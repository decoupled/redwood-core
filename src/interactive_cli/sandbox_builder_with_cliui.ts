import { resolve } from "path";
import { RWProject } from "../core/RWProject";
import { DefaultHost } from "../ide";
import { build } from "./command_builder";
import { CLIUI } from "./ui";

async function test() {
  const ui = new CLIUI();
  const projectRoot = resolve(__dirname, "../../fixtures/example-todo-master");
  const host = new DefaultHost();
  const project = new RWProject({ projectRoot, host });
  const cmd = await build({ project, ui, args: {} });
  console.log(`cmd = ${cmd}`);
}

test();
