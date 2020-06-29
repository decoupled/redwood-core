import { LazyGetter as lazy } from "lazy-get-decorator";
import _ from "lodash";
import { Debounce } from "lodash-decorators";
import {
  createConnection,
  InitializeParams,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { HostWithDocumentsStore } from "./ide";
import { getOutline, outlineToJSON } from "./outline";
import { RWProject } from "./project";
import {
  Diagnostic_compare,
  Range_contains,
} from "./x/vscode-languageserver-types";

const REFRESH_DIAGNOSTICS_INTERVAL = 5000;

class Connection {
  initializeParams!: InitializeParams;
  documents = new TextDocuments(TextDocument);
  connection = createConnection(ProposedFeatures.all);
  constructor() {
    const { connection, documents } = this;
    connection.onInitialize((params) => {
      connection.console.log(
        `Redwood.js Language Server onInitialize(), PID=${process.pid}`
      );
      this.initializeParams = params;
      params.capabilities.workspace?.workspaceEdit?.documentChanges;
      return {
        capabilities: {
          textDocumentSync: {
            openClose: true,
            change: TextDocumentSyncKind.Full,
          },
          // completionProvider: {
          //   resolveProvider: true,
          // },
          implementationProvider: true,
          definitionProvider: true,
          codeActionProvider: true,
        },
      };
    });

    connection.onInitialized(async () => {
      // custom method for decoupled studio
      connection.onRequest("getOutline", async () => {
        const project = this.getProject();
        if (!project) return;
        return await outlineToJSON(getOutline(project));
      });
      connection.console.log("onInitialized");
      setInterval(
        () => this.refreshDiagnostics(),
        REFRESH_DIAGNOSTICS_INTERVAL
      );
      const folders = await connection.workspace.getWorkspaceFolders();
      if (folders) {
        for (const folder of folders) {
          this.projectRoot = folder.uri.substr(7); // remove file://
        }
      }

      if (this.hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders((_event) => {
          connection.console.log("Workspace folder change event received.");
        });
      }
    });
    documents.onDidClose((e: any) => {});
    documents.onDidOpen((e: any) => {});
    // The content of a text document has changed. This event is emitted
    // when the text document first opened or when its content has changed.
    documents.onDidChangeContent((change: { document: TextDocument }) => {
      this.refreshDiagnostics();
    });
    connection.onDidChangeWatchedFiles((_change) => {
      this.refreshDiagnostics();
    });

    connection.onImplementation(async (params) => {
      const info = await this.collectIDEInfo(params.textDocument.uri);
      for (const i of info) {
        if (i.kind === "Implementation") {
          if (Range_contains(i.location.range, params.position)) {
            return i.target;
          }
        }
      }
    });

    connection.onDefinition(async (params) => {
      const info = await this.collectIDEInfo(params.textDocument.uri);
      for (const i of info) {
        if (i.kind === "Definition") {
          if (Range_contains(i.location.range, params.position)) {
            return i.target;
          }
        }
      }
    });

    connection.onCodeAction(
      async ({ range, context, textDocument: { uri } }) => {
        const node = await this.getProject()?.findNode(uri);
        if (!node) return [];
        if (context.diagnostics.length > 0) {
          // find quick-fixes associated to diagnostics
          const node_diagnostics = await node.collectDiagnostics();
          for (const ctx_d of context.diagnostics) {
            // context contains diagnostics that are currently displayed to the user
            for (const node_xd of node_diagnostics) {
              const node_d = node_xd.diagnostic;
              if (Diagnostic_compare(ctx_d, node_d)) {
                if (node_xd.quickFix) {
                  const a = await node_xd.quickFix();
                  if (a) {
                    a.kind = "quickfix";
                    a.diagnostics = [ctx_d];
                    return [a];
                  }
                }
              }
            }
          }
        }
        return [];
      }
    );

    // Make the text document manager listen on the connection
    // for open, change and close text document events
    documents.listen(connection);

    // Listen on the connection
    connection.listen();
  }
  projectRoot: string | undefined;
  getProject() {
    if (!this.projectRoot) return undefined;
    return new RWProject({ projectRoot: this.projectRoot, host: this.host });
  }
  async collectIDEInfo(uri: string) {
    const node = await this.getProject()?.findNode(uri);
    if (!node) return [];
    return await node.collectIDEInfo();
  }
  @lazy() get host() {
    return new HostWithDocumentsStore(this.documents);
  }
  get hasWorkspaceFolderCapability() {
    return (
      this.initializeParams.capabilities.workspace?.workspaceFolders === true
    );
  }

  private refreshDiagnostics_previousURIs: string[] = [];
  @Debounce(1000)
  private async refreshDiagnostics() {
    const project = this.getProject();
    if (project) {
      const ds = await project.collectDiagnostics();
      const grouped = _.groupBy(ds, (d) => d.uri);
      const dss = _.mapValues(grouped, (xds) => xds.map((xd) => xd.diagnostic));
      const newURIs = Object.keys(dss);
      const allURIs = newURIs.concat(this.refreshDiagnostics_previousURIs);
      this.refreshDiagnostics_previousURIs = newURIs;
      for (const uri of allURIs) {
        let diagnostics = dss[uri] ?? [];
        this.connection.sendDiagnostics({ uri, diagnostics });
      }
    }
  }
}

new Connection();
