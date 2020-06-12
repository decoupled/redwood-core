import { Box, Color, render, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";
import { useAsync } from "react-async-hook";
import { DefaultHost, OutlineItem } from "./ide";
import { RWProject } from "./project";
import { resolve } from "path";

const projectRoot = resolve(__dirname, "..", "fixtures/example-todo-master");

const RedwoodOutline = (props: { projectRoot: string }) => {
  const projectRoot = props.projectRoot;
  const project = useMemo(
    () => new RWProject({ projectRoot, host: new DefaultHost() }),
    [projectRoot]
  );
  return <OutlineItemUI data={project} depth={0} />;
};

const OutlineItemUI = (props: { data: OutlineItem; depth: number }) => {
  const children = useAsync(async () => {
    const cc = props.data.outlineChildren ?? [];
    return Array.isArray(cc) ? cc : await cc;
  }, []);
  return (
    <Box flexDirection="column">
      {renderLabel()}
      {renderChildren()}
    </Box>
  );
  function renderLabel() {
    const bullets = props.depth === 0 ? "" : " ".repeat(props.depth) + "- ";
    return (
      <Box flexDirection="row">
        <Text>
          <Color green>{bullets + props.data.outlineLabel}</Color>
        </Text>
        <Color hex="555"> - {props.data.outlineDescription}</Color>
      </Box>
    );
  }
  function renderChildren() {
    return (children.result ?? []).map((r) => (
      <OutlineItemUI key={r.id} data={r} depth={props.depth + 1} />
    ));
  }
};

render(<RedwoodOutline projectRoot={projectRoot} />);
