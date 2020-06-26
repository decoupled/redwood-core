import { Box, render, Text, Color } from "ink";
import { resolve } from "path";
import React from "react";
import { DiagnosticsUI, OutlineUI, useProject } from "./ui";

const projectRoot = resolve(
  __dirname,
  "..",
  "fixtures/example-todo-master-with-errors"
);

const App = (props: { projectRoot: string }) => {
  const project = useProject(projectRoot);
  return (
    <Box flexDirection="column">
      <Text>
        <Color yellow># Redwood Project Analysis</Color>
      </Text>
      <Text>
        <Color yellow>## Project Outline</Color>
      </Text>
      <OutlineUI project={project} />
      <Text>
        <Color yellow>## Project Diagnostics</Color>
      </Text>
      <DiagnosticsUI project={project} />
    </Box>
  );
};

render(<App projectRoot={projectRoot} />);
