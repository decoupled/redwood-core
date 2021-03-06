import { Box, Color, Text } from "ink";
import React, { useMemo } from "react";
import { useAsync } from "react-async-hook";
import { RWProject } from "./core/RWProject";
import { DefaultHost } from "./ide";
import { getOutline, OutlineItem } from "./outline";
import {
  ExtendedDiagnostic,
  LocationLike_toLink,
} from "./x/vscode-languageserver-types";

export const DiagnosticsUI = (props: { project: RWProject }) => {
  const diagnostics = useAsync(() => props.project.collectDiagnostics(), []);
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
  const link = LocationLike_toLink(props.diagnostic);
  return (
    <Text>
      <Color red>{props.diagnostic.diagnostic.message}</Color>
      <Color hex="777">{link}</Color>
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
    const { label, description, link } = props.data;
    return (
      <Box flexDirection="row">
        <Text>
          <Color hex="eee">{bullets + label}</Color>
        </Text>
        {description ? <Color hex="aaa">{" " + description}</Color> : null}
        {link ? <Color hex="555">{" " + link}</Color> : null}
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
