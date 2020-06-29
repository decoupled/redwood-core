import camelcase from "camelcase";
import { Memoize as memo } from "lodash-decorators";
import { RWProject } from "./project";
// import { redwood_gen_dry_run } from "./redwood-gen-dry-run";
import { validateRoutePath } from "./util";
import { VSCodeWindowMethods } from "./x/vscode";

type YargsStyleArgs = Record<string, string | undefined>;

interface Opts {
  args: YargsStyleArgs;
  project: RWProject;
  window: VSCodeWindowMethods;
}

export function run(opts: Opts) {
  return new Runner(opts).run();
}

class Runner {
  constructor(public opts: Opts) {}
  @memo()
  async run() {
    const { projectRoot } = this.opts.project;
    const cmd = await this.buildCommand();
    if (!cmd) return;
    if (isInterceptable(cmd)) {
      await this.applyWithProgress(cmd);
    } else {
      // this.opts.window.showInformationMessage(`cmd: yarn redwood ${cmd}`);
      // return;
      this.opts.window.createTerminal2({
        name: "Redwood",
        cwd: projectRoot,
        cmd: "yarn redwood " + cmd,
      });
    }
    function isInterceptable(cmd: string) {
      return false; // <--- TODO: remove this once we fix the dry run
      if (!cmd.startsWith("generate")) return false;
      if (cmd.startsWith("generate sdl")) return false;
      if (cmd.startsWith("generate scaffold")) return false;
      return true;
    }
  }
  @memo()
  async arg_command(): Promise<string> {
    return (
      this.opts.args["_0"] ??
      this.breakIfNull(
        await this.opts.window.showQuickPick(["generate", "db"], {
          placeHolder: "Choose Redwood CLI command",
        })
      )
    );
  }
  @memo()
  async arg_generate_type(): Promise<string> {
    return (
      this.opts.args["_1"] ??
      this.breakIfNull(await this.prompt_generatorTypes())
    );
  }
  @memo()
  async arg_db_type(): Promise<string> {
    return (
      this.opts.args["_1"] ?? this.breakIfNull(await this.prompt_dbTypes())
    );
  }
  @memo()
  async arg_generate_sdl_modelName(): Promise<string> {
    return (
      this.opts.args["_2"] ??
      this.breakIfNull(await this.prompt_modelname("Choose Model for SDL..."))
    );
  }
  @memo()
  async arg_generate_scaffold_modelName(): Promise<string> {
    return (
      this.opts.args["_2"] ??
      this.breakIfNull(
        await this.prompt_modelname("Choose Model to Scaffold...")
      )
    );
  }
  @memo()
  async buildCommand(): Promise<string | undefined> {
    try {
      const cmd = await this.arg_command();
      if (cmd === "generate") {
        return await this.generate(await this.arg_generate_type());
      }
      if (cmd === "db") {
        const dbType = await this.arg_db_type();
        if (dbType === "save") {
          const name = await this.prompt_name("choose migration name");
          if (!name) return;
          return `db save ${name}`;
        } else if (dbType === "up") {
          return `db up`;
        }
        return;
      }
    } catch (e) {
      if (e.message === "stop") return;
      throw e;
    }
  }
  private async generate(type: string) {
    const { projectRoot } = this.opts.project;
    if (type === "page") {
      const pageName = await this.prompt_name(
        "Page Name (ex: Home, about, MyPage, contact)"
      );
      if (!pageName) return;
      const defaultPath = "/" + camelcase(pageName);
      const path = await this.prompt_pagePath(defaultPath);
      return `generate page ${pageName} ${path}`;
    }
    if (type === "cell") {
      const name = await this.prompt_name("Cell Name");
      if (!name) return;
      return `generate cell ${name}`;
    }
    if (type === "scaffold") {
      const modelName = await this.arg_generate_scaffold_modelName();
      return `generate scaffold ${modelName}`;
    }
    if (type === "component") {
      const name = await this.prompt_name("Component Name");
      if (!name) return;
      return `generate component ${name}`;
    }
    if (type === "layout") {
      const name = await this.prompt_name("Layout Name");
      if (!name) return;
      return `generate layout ${name}`;
    }
    if (type === "sdl") {
      const modelName = await this.arg_generate_sdl_modelName();
      const opts = await this.promp_sdl_options();
      if (!opts) return;
      // services: { type: 'boolean', default: true },
      // crud: { type: 'boolean', default: false },
      // force: { type: 'boolean', default: false },
      return `generate sdl ${modelName}`;
    }
  }
  private stop(): never {
    throw new Error("stop");
  }
  private breakIfNull<T>(x: T): NonNullable<T> {
    if (!x) this.stop();
    return x as any;
  }
  async prompt_name(prompt: string) {
    return this.opts.window.showInputBox({ prompt });
  }
  async prompt_modelname(msg: string) {
    const modelNames = await this.opts.project.prismaDMMFModelNames();
    if (modelNames.length === 0) {
      this.opts.window.showInformationMessage(
        'You must define at least one model in the "schema.prisma" file'
      );
      return;
    }
    return await this.opts.window.showQuickPick(modelNames, {
      placeHolder: msg,
    });
  }
  async promp_sdl_options(): Promise<
    Set<"services" | "crud" | "force"> | undefined
  > {
    const opts = await this.opts.window.showQuickPick(
      [
        {
          label: "services",
          description: "generate services",
          picked: true,
        },
        {
          label: "crud",
          description: "generate CRUD",
          picked: false,
        },
        {
          label: "force",
          description: "overwrite existing files",
          picked: false,
        },
      ],
      { canPickMany: true }
    );
    if (!opts) return;
    return new Set(opts.map((o) => o.label) as any);
  }
  async applyWithProgress(cmd: string) {
    await this.opts.window.withProgress(
      {
        title: "redwood " + cmd,
        location: `vscode.ProgressLocation.Notification`,
      },
      () => this.applyyy(cmd)
    );
  }

  async applyyy(cmd: string) {
    this.opts.window.showInformationMessage("run cmd " + cmd);
    // const { stdout, files } = await redwood_gen_dry_run(
    //   projectRoot,
    //   cmd,
    //   getFileOverrides(),
    //   vscode_ExtensionContext_current().extensionPath
    // );
    // await vscode_workspace_applyEdit2({ files: new Map(files), save: true });
  }

  getFileOverrides(): any {
    // const overrides = {};
    // for (const doc of vscode.workspace.textDocuments)
    //   if (doc.isDirty) overrides[doc.fileName] = doc.getText();
    // return overrides;
  }
  async prompt_generatorTypes() {
    return await this.opts.window.showQuickPick(generatorTypes, {
      placeHolder: "Choose Redwood component type to generate",
    });
  }

  async prompt_dbTypes() {
    return await this.opts.window.showQuickPick(dbTypes, {
      placeHolder: "Choose db command",
    });
  }

  async prompt_pagePath(defaultPath: string) {
    return await this.opts.window.showInputBox({
      prompt: "path",
      value: defaultPath,
      valueSelection: [1, defaultPath.length],
      validateInput(path: string) {
        try {
          validateRoutePath(path);
        } catch (e) {
          return e + "";
        }
      },
    });
  }
}

const generatorTypes = [
  "page",
  "cell",
  "scaffold",
  "component",
  "layout",
  "sdl",
  "service",
];

const dbTypes = ["down", "generate", "save", "seed", "up"];

// export async function redwoodjs_cli_generate(
//   projectRoot: string,
//   generatorType?: string
// ) {
//   await redwoodjs_cli({
//     projectRoot,
//     args: { _0: "generate", _1: generatorType },
//   });
// }

// export async function redwoodjs_cli_generate_sdl(
//   projectRoot: string,
//   modelName: string
// ) {
//   await redwoodjs_cli({
//     projectRoot,
//     args: { _0: "generate", _1: "sdl", _2: modelName },
//   });
// }

// export async function redwoodjs_cli_generate_scaffold(
//   projectRoot: string,
//   modelName: string
// ) {
//   await redwoodjs_cli({
//     projectRoot,
//     args: { _0: "generate", _1: "scaffold", _2: modelName },
//   });
// }

// export async function redwoodjs_cli_db_save(projectRoot: string) {
//   await redwoodjs_cli({
//     projectRoot,
//     args: { _0: "db", _1: "save" },
//   });
// }

// export async function redwoodjs_cli_db_up(projectRoot: string) {
//   await redwoodjs_cli({
//     projectRoot,
//     args: { _0: "db", _1: "up" },
//   });
// }
