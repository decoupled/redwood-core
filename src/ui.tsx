import { Box, Color, Text } from "ink";
import React, { useMemo } from "react";
import { useAsync } from "react-async-hook";
import { DefaultHost, ExtendedDiagnostic } from "./ide";
import { getOutline, OutlineItem } from "./outline";
import { RWProject } from "./project";

export const DiagnosticsUI = (props: { project: RWProject }) => {
  const diagnostics = useAsync(() => props.project.getAllDiagnostics(), []);
  if (!diagnostics.result) return null;
  return (
    <Box flexDirection="column">
      {diagnostics.result.map((d, i) => (
        <DiagnosticUI diagnostic={d} key={i} />
      ))}
    </Box>
  );
};

const DiagnosticUI = (props: { diagnostic: ExtendedDiagnostic }) => {
  const d = props.diagnostic;
  const { start } = d.diagnostic.range;
  return (
    <Text>
      <Color red>{d.diagnostic.message}</Color>
      <Color hex="777">
        {" (" +
          d.uri.substr(7) +
          ":" +
          start.line +
          ":" +
          start.character +
          ")"}
      </Color>
    </Text>
  );
};

export const OutlineUI = (props: { project: RWProject }) => {
  return <OutlineItemUI data={getOutline(props.project)} depth={0} />;
};

const OutlineItemUI = (props: { data: OutlineItem; depth: number }) => {
  const children = useAsync(async () => {
    if (props.data.children) return await props.data.children();
    return [];
  }, []);
  return (
    <Box flexDirection="column">
      {renderLabel()}
      {renderChildren()}
    </Box>
  );
  function renderLabel() {
    const bullets = props.depth === 0 ? "" : "  ".repeat(props.depth) + "";
    const { label, description } = props.data;
    return (
      <Box flexDirection="row">
        <Text>
          <Color green>{bullets + label}</Color>
        </Text>
        {description ? <Color hex="555">{" " + description}</Color> : null}
      </Box>
    );
  }
  function renderChildren() {
    return (children.result ?? []).map((r) => (
      <OutlineItemUI key={r.key ?? r.label} data={r} depth={props.depth + 1} />
    ));
  }
};

export function useProject(projectRoot: string): RWProject {
  return useMemo(
    () => new RWProject({ projectRoot, host: new DefaultHost() }),
    [projectRoot]
  );
}
