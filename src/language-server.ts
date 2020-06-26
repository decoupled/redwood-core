import _ from "lodash";
import * as lsp from "vscode-languageserver";
import {
  createConnection,
  InitializeParams,
  ProposedFeatures,
  TextDocuments,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DefaultHost, Host, nudgeDiagnostic } from "./ide";
import { RWProject } from "./project";
import { getOutline, outlineToJSON } from "./outline";

const languageTsIDs = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
];

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
        change: lsp.TextDocumentSyncKind.Full,
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
  setInterval(updateDiagnostics, 3000);
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
    const ds = await project.getAllDiagnostics();
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

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change: { document: TextDocument }) => {
  //validateTextDocument(change.document);
  const docs = documents;
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  //connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((_change) => {});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();

class HostWithDocumentsStore implements Host {
  defaultHost = new DefaultHost();
  constructor(public documents: TextDocuments<TextDocument>) {}
  readFileSync(path: string) {
    const uri = `file://${path}`;
    const doc = this.documents.get(uri);
    if (doc) return doc.getText();
    return this.defaultHost.readFileSync(path);
  }
  existsSync(path: string) {
    return this.defaultHost.existsSync(path);
  }
  readdirSync(path: string) {
    return this.defaultHost.readdirSync(path);
  }
  globSync(pattern: string) {
    return this.defaultHost.globSync(pattern);
  }
}
