import camelcase from "camelcase";
import { RWProject } from "../core/RWProject";
import { validateRoutePath } from "../util";
import { memo } from "../x/decorators";
import { YargsStyleArgs } from "../x/yargs";
import { UI } from "./ui";

export interface Opts {
  args: YargsStyleArgs;
  project: RWProject;
  ui: UI;
}

export function build(opts: Opts): Promise<string | undefined> {
  return new CommandBuilder(opts).buildCommand();
}

class CommandBuilder {
  constructor(public opts: Opts) {}
  @memo()
  async buildCommand(): Promise<string | undefined> {
    try {
      const cmd = await this.arg_command();
      if (cmd === "generate") {
        return await this.generate(await this.arg_generate_type());
      }
      if (cmd === "db") {
        const dbType = await this.arg_db_operation();
        if (dbType === "save") {
          const name = await this.prompt("Choose migration name");
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
  @memo()
  async arg_command(): Promise<string> {
    return (
      this.opts.args["_0"] ??
      this.breakIfNull(
        await this.opts.ui.pickOne(
          ["generate", "db"],
          "Choose Redwood CLI command"
        )
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
  async arg_db_operation(): Promise<string> {
    return (
      this.opts.args["_1"] ??
      this.breakIfNull(await this.prompt_db_operations())
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

  private async generate(type: string) {
    if (type === "page") {
      const pageName = await this.prompt(
        "Page Name (ex: Home, about, MyPage, contact)"
      );
      const defaultPath = "/" + camelcase(pageName);
      const path = await this.prompt_pagePath(defaultPath);
      return `generate page ${pageName} ${path}`;
    }
    if (type === "cell") {
      return `generate cell ${await this.prompt("Cell Name")}`;
    }
    if (type === "scaffold") {
      const modelName = await this.arg_generate_scaffold_modelName();
      return `generate scaffold ${modelName}`;
    }
    if (type === "component") {
      return `generate component ${await this.prompt("Component Name")}`;
    }
    if (type === "layout") {
      return `generate layout ${await this.prompt("Layout Name")}`;
    }
    if (type === "sdl") {
      const modelName = await this.arg_generate_sdl_modelName();
      const opts = await this.prompt_sdl_options();
      if (!opts) return;
      // TODO: serialize options
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
  /**
   * prompt for a required (and non-empty) string
   * @param msg
   */
  async prompt(msg: string): Promise<string> {
    let v = await this.opts.ui.prompt(msg);
    if (v === "") v = undefined;
    return this.breakIfNull(v);
  }
  async prompt_modelname(msg: string) {
    const modelNames = await this.opts.project.prismaDMMFModelNames();
    if (modelNames.length === 0) {
      this.opts.ui.info(
        'You must define at least one model in the "schema.prisma" file'
      );
      return;
    }
    return await this.opts.ui.pickOne(modelNames, msg);
  }
  async prompt_sdl_options(): Promise<
    Set<"services" | "crud" | "force"> | undefined
  > {
    const opts = await this.opts.ui.pickMany(
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
      "Options..."
    );
    if (!opts) return;
    return new Set(opts) as any;
  }

  async prompt_generatorTypes() {
    return await this.opts.ui.pickOne(
      generatorTypes,
      "Choose Redwood component type to generate"
    );
  }

  async prompt_db_operations() {
    return await this.opts.ui.pickOne(dbOperations, "Choose db command");
  }

  async prompt_pagePath(defaultPath: string) {
    return await this.opts.ui.prompt("path", {
      // prompt: "path",
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

const dbOperations = ["down", "generate", "save", "seed", "up"];
