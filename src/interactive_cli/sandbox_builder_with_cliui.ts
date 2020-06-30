import { build } from "./command_builder";
import { CLIUI } from "./ui";
import { RWProject } from "../project";
import { resolve } from "path";
import { DefaultHost } from "../ide";

async function test() {
  const ui = new CLIUI();
  const projectRoot = resolve(__dirname, "../../fixtures/example-todo-master");
  const host = new DefaultHost();
  const project = new RWProject({ projectRoot, host });
  const cmd = await build({ project, ui, args: {} });
  console.log(`cmd = ${cmd}`);
}

test();
