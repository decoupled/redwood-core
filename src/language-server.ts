import _ from "lodash";
import {
  createConnection,
  InitializeParams,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { HostWithDocumentsStore, nudgeDiagnostic } from "./ide";
import { getOutline, outlineToJSON } from "./outline";
import { RWProject } from "./project";

const languageTsIDs = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
];

const UPDATE_DIAGNOSTICS_INTERVAL = 5000;

const connection = createConnection(ProposedFeatures.all);

const documents = new TextDocuments(TextDocument);

let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams) => {
  connection.console.log(
    `redwood.js language server onInitialize() (PID = ${process.pid})`
  );
  const capabilities = params.capabilities;

  hasWorkspaceFolderCapability = !!capabilities?.workspace?.workspaceFolders;

  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Full,
      },
      // codeActionProvider: {
      //   codeActionKinds: [lsp.CodeActionKind.QuickFix],
      // },
      // completionProvider: {
      //   resolveProvider: true,
      // },
    },
  };
});

let projectRoot: string | undefined;
function getProject() {
  if (!projectRoot) return undefined;
  const host = new HostWithDocumentsStore(documents);
  const project = new RWProject({ projectRoot, host });
  return project;
}

connection.onInitialized(async () => {
  // custom method for decoupled studio
  connection.onRequest("getOutline", async () => {
    const project = getProject();
    if (!project) return;
    return await outlineToJSON(getOutline(project));
  });
  connection.console.log("onInitialized");
  setInterval(updateDiagnosticsDebounced, UPDATE_DIAGNOSTICS_INTERVAL);
  const folders = await connection.workspace.getWorkspaceFolders();
  if (folders) {
    for (const folder of folders) {
      projectRoot = folder.uri.substr(7); // remove file://
    }
  }

  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Workspace folder change event received.");
    });
  }
});

documents.onDidClose((e: any) => {});
documents.onDidOpen((e: any) => {});

let previousDiagnosticURIs: string[] = [];
async function updateDiagnostics() {
  const project = getProject();
  if (project) {
    const ds = await project.collectDiagnostics();
    //connection.console.log("updateDiagnostics length=" + ds.length);
    const grouped = _.groupBy(ds, (d) => d.uri);
    const dss = _.mapValues(grouped, (xds) => xds.map((xd) => xd.diagnostic));
    const newURIs = Object.keys(dss);
    const allURIs = newURIs.concat(previousDiagnosticURIs);
    previousDiagnosticURIs = newURIs;
    for (const uri of allURIs) {
      let diagnostics = dss[uri] ?? [];
      // for some reason we need to nudge before sending over?
      diagnostics = diagnostics.map((d) => nudgeDiagnostic(d, -1));
      connection.sendDiagnostics({ uri, diagnostics });
    }
  }
}

const updateDiagnosticsDebounced = _.debounce(updateDiagnostics, 1000);

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change: { document: TextDocument }) => {
  // TODO: update diagnostics
  updateDiagnosticsDebounced();
});

connection.onDidChangeWatchedFiles((_change) => {
  // TODO: update diagnostics
  updateDiagnosticsDebounced();
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
