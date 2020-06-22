import { FileNode } from "./ide";
import { RWProject } from "./project";

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
}

export function getOutline(project: RWProject): OutlineItem {
  return {
    label: "Redwood.js",
    async children() {
      return [
        {
          label: "pages",
          async children() {
            return fromFiles(project.pages);
          },
        },
        {
          label: "routes",
          async children() {
            return project.router.routes.map((route) => {
              return {
                id: route.id,
                label: route.outlineLabel,
                description: route.outlineDescription,
              };
            });
          },
        },
        {
          label: "components",
          async children() {
            return fromFiles(project.components);
          },
        },
        {
          label: "layouts",
          async children() {
            return fromFiles(project.layouts);
          },
        },
        {
          label: "cells",
          async children() {
            return fromFiles(project.cells);
          },
        },
        {
          label: "services",
          async children() {
            return fromFiles(project.services);
          },
        },
        {
          label: "schema",
          async children() {
            const dmmf = await project.prismaDMMF();
            return dmmf.datamodel.models.map((model) => {
              return {
                label: model.name,
                async children() {
                  return model.fields.map((f) => {
                    return { label: f.name, description: `:${f.type}` };
                  });
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
  };
}
