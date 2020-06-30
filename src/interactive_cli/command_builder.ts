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
  constructor(private opts: Opts) {}

  @memo()
  async buildCommand(): Promise<string | undefined> {
    try {
      switch (await this.arg_command()) {
        case "generate":
          return await this.generate(await this.arg_generate_type());
        case "db":
          switch (await this.arg_db_operation()) {
            case "save":
              const name = await this.prompts.prompt("Choose migration name");
              return `db save ${name}`;
            case "up":
              return `db up`;
          }
          return;
      }
    } catch (e) {
      if (e.message === "break") return;
      throw e;
    }
  }

  private async generate(type: string) {
    switch (type) {
      case "page":
        const pageName = await this.prompts.prompt(
          "Page Name (ex: Home, about, MyPage, contact)"
        );
        const defaultPath = "/" + camelcase(pageName);
        const path = await this.prompts.pagePath(defaultPath);
        return `generate page ${pageName} ${path}`;
      case "cell":
        return `generate cell ${await this.prompts.prompt("Cell Name")}`;
      case "scaffold":
        return `generate scaffold ${await this.arg_generate_scaffold_modelName()}`;
      case "component":
        return `generate component ${await this.prompts.prompt(
          "Component Name"
        )}`;
      case "layout":
        return `generate layout ${await this.prompts.prompt("Layout Name")}`;
      case "sdl":
        const modelName = await this.arg_generate_sdl_modelName();
        const opts = await this.prompts.sdl_options();
        if (!opts) return;
        // TODO: serialize options
        // services: { type: 'boolean', default: true },
        // crud: { type: 'boolean', default: false },
        // force: { type: 'boolean', default: false },
        return `generate sdl ${modelName}`;
    }
  }

  prompts = new PromptHelper(this.opts);

  @memo()
  async arg_command(): Promise<string> {
    return this.opts.args["_0"] ?? breakIfNull(await this.prompts.command());
  }
  @memo()
  async arg_generate_type(): Promise<string> {
    return (
      this.opts.args["_1"] ?? breakIfNull(await this.prompts.generate_type())
    );
  }
  @memo()
  async arg_db_operation(): Promise<string> {
    return (
      this.opts.args["_1"] ?? breakIfNull(await this.prompts.db_operations())
    );
  }
  @memo()
  async arg_generate_sdl_modelName(): Promise<string> {
    return (
      this.opts.args["_2"] ??
      breakIfNull(await this.prompts.model("Choose Model for SDL..."))
    );
  }
  @memo()
  async arg_generate_scaffold_modelName(): Promise<string> {
    return (
      this.opts.args["_2"] ??
      breakIfNull(await this.prompts.model("Choose Model to Scaffold..."))
    );
  }
}

/**
 * A set of specialized prompt helpers
 * that wrap around the UI methods and sometimes query the RWProject
 */
class PromptHelper {
  constructor(private opts: Opts) {}

  /**
   * prompt for a required (and non-empty) string
   * @param msg
   */
  async prompt(msg: string): Promise<string> {
    let v = await this.opts.ui.prompt(msg);
    if (v === "") v = undefined;
    return breakIfNull(v);
  }
  async command() {
    return await this.opts.ui.pickOne(
      ["generate", "db"],
      "Choose Redwood CLI command"
    );
  }
  /**
   * Pick a model name from prisma.schema
   * @param msg
   */
  async model(msg: string) {
    const models = await this.opts.project.prismaDMMFModelNames();
    if (models.length === 0) {
      this.opts.ui.info(
        'You must define at least one model in the "schema.prisma" file'
      );
      return;
    }
    return await this.opts.ui.pickOne(models, msg);
  }
  async sdl_options(): Promise<Set<"services" | "crud" | "force"> | undefined> {
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

  async generate_type() {
    return await this.opts.ui.pickOne(
      generatorTypes,
      "Choose Redwood component type to generate"
    );
  }

  async db_operations() {
    return await this.opts.ui.pickOne(dbOperations, "Choose db command");
  }

  async pagePath(defaultPath: string) {
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

function breakIfNull<T>(x: T): NonNullable<T> {
  if (!x) throw new Error("break");
  return x as any;
}
