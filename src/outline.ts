import { RWProject } from "./core/RWProject";
import { FileNode } from "./ide";

/*
- all items have icons. in vscode you can create items without icons but
  they introduce layout consistency issues.
-  
*/

/*
actions that are consistent:
*/

enum Icon {
  redwood = "redwood",
  route = "route",
  route_private = "route_private",
}

export interface OutlineItem {
  /**
   * Label for the outline item.
   * This is the main text.
   */
  label: string;
  /**
   * If label is not unique amongst siblings, key is used to disambiguate.
   * This is similar to ReactNode.key
   */
  key?: string;
  /**
   * Secondary text.
   */
  description?: string;

  /**
   * - If present, this item will be rendered as a folder (with an expand button).
   * - If undefined, this item will be rendered as a leaf
   */
  children?(): Promise<OutlineItem[]>;

  /**
   * Whether this outline item should be expanded by default.
   * This is only relevant if children() is defined
   */
  expanded?: boolean;

  /**
   * An action to execute when this outline item is clicked.
   * It can be
   * - a file (with optional position)
   * ex: "file:///Users/foo/bar/project/myfile.js:3:10"
   * ex: "file:///somefile.ts"
   * - a URL
   * ex: "http://localhost:9999/foo"
   * - a redwood CLI action
   * ex: "rw g page"
   */
  link?: string;

  icon?: Icon;
}

export function getOutline(project: RWProject): OutlineItem {
  project.pathHelper.api; //?
  return {
    label: "Redwood.js",
    icon: Icon.redwood,
    async children() {
      return [
        {
          label: "pages",
          onAdd: "rw g page",
          link: `file://${project.pathHelper.web.pages}`,
          async children() {
            return fromFiles(project.pages);
          },
        },
        {
          label: "Routes.js",
          link: project.router.uri,
          onAdd: "rw g page",
          async children() {
            return project.router.routes.map((route) => {
              return {
                id: route.id,
                label: route.outlineLabel,
                description: route.outlineDescription,
                link: route.outlineLink,
                icon: route.isAuthenticated ? Icon.route_private : Icon.route,
              };
            });
          },
        },
        {
          label: "components",
          onAdd: "rw g component",
          link: `file://${project.pathHelper.web.components}`,
          async children() {
            return fromFiles(project.components);
          },
        },
        {
          label: "layouts",
          onAdd: "rw g layout",
          link: `file://${project.pathHelper.web.layouts}`,
          async children() {
            return fromFiles(project.layouts);
          },
        },
        {
          label: "cells",
          onAdd: "rw g cell",
          link: `file://${project.pathHelper.web.components}`,
          async children() {
            return fromFiles(project.cells);
          },
        },
        {
          label: "services",
          onAdd: "rw g service",
          link: `file://${project.pathHelper.api.services}`,
          async children() {
            return fromFiles(project.services);
          },
        },
        {
          label: "functions",
          onAdd: "rw g function",
          link: `file://${project.pathHelper.api.functions}`,
          async children() {
            return fromFiles(project.functions);
          },
        },
        {
          label: "schema.prisma",
          link: `file://${project.pathHelper.api.dbSchema}`,
          async children() {
            const dmmf = await project.prismaDMMF();
            return dmmf.datamodel.models.map((model) => {
              return {
                label: model.name,
                async children() {
                  const fields = model.fields.map((f) => {
                    return { label: f.name, description: `:${f.type}` };
                  });
                  const actions: OutlineItem[] = [
                    {
                      label: "generate sdl",
                      description:
                        "create graphql interface to access this model",
                      link: `rw g sdl ${model.name}`,
                    },
                    {
                      label: "generate scaffold",
                      description:
                        "generate pages, SDL, and a services object for this model",
                      link: `rw g scaffold ${model.name}`,
                    },
                  ];
                  return [...fields, ...actions];
                },
              };
            });
          },
        },
      ];
    },
  };
}

function fromFiles(fileNodes: FileNode[]): OutlineItem[] {
  return fileNodes.map(fromFile);
}

function fromFile(fileNode: FileNode): OutlineItem {
  return {
    key: fileNode.id,
    label: fileNode.basenameNoExt,
    link: fileNode.uri,
  };
}

/**
 * this is used for
 * @param uri
 * @param root
 */
export async function findOutlineItemForFile(
  uri: string,
  root: OutlineItem
): Promise<OutlineItem | undefined> {
  if (root.link === uri) return root;
  // bail out early on branches are not potential parents
  if (root.link) if (!uri.startsWith(root.link)) return undefined;
  const children = root.children ? await root.children() : [];
  for (const c of children) {
    const ff = await findOutlineItemForFile(uri, c);
    if (ff) return ff;
  }
}

export async function outlineToJSON(item: OutlineItem) {
  const cs = item.children ? await item.children() : [];
  const css = await Promise.all(cs.map(outlineToJSON));
  return { ...item, children: css };
}
