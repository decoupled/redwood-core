import {
  CompletionItem,
  CompletionItemKind,
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  InitializeParams,
  ProposedFeatures,
  TextDocumentPositionParams,
  TextDocuments,
} from "vscode-languageserver";
import * as lsp from "vscode-languageserver";

import { TextDocument } from "vscode-languageserver-textdocument";

const LanguageTsIds = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
];

const connection = createConnection(ProposedFeatures.all);

const documents = new TextDocuments(TextDocument);

let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  hasWorkspaceFolderCapability = !!capabilities?.workspace?.workspaceFolders;
  hasDiagnosticRelatedInformationCapability = !!capabilities?.textDocument
    ?.publishDiagnostics?.relatedInformation;

  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: lsp.TextDocumentSyncKind.Full,
      },
      codeActionProvider: {
        codeActionKinds: [lsp.CodeActionKind.QuickFix],
      },
      // completionProvider: {
      //   resolveProvider: true,
      // },
    },
  };
});

connection.onInitialized(() => {
  if (hasWorkspaceFolderCapability) {
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
  validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  //connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((_change) => {});

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    return [
      {
        label: "TypeScript",
        kind: CompletionItemKind.Text,
        data: 1,
      },
      {
        label: "JavaScript",
        kind: CompletionItemKind.Text,
        data: 2,
      },
    ];
  }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
  (item: CompletionItem): CompletionItem => {
    if (item.data === 1) {
      item.detail = "TypeScript details";
      item.documentation = "TypeScript documentation";
    } else if (item.data === 2) {
      item.detail = "JavaScript details";
      item.documentation = "JavaScript documentation";
    }
    return item;
  }
);

/*
  connection.onDidOpenTextDocument((params) => {
      // A text document got opened in VS Code.
      // params.uri uniquely identifies the document. For documents store on disk this is a file URI.
      // params.text the initial full content of the document.
      connection.console.log(`${params.textDocument.uri} opened.`);
  });
  connection.onDidChangeTextDocument((params) => {
      // The content of a text document did change in VS Code.
      // params.uri uniquely identifies the document.
      // params.contentChanges describe the content changes to the document.
      connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
  });
  connection.onDidCloseTextDocument((params) => {
      // A text document got closed in VS Code.
      // params.uri uniquely identifies the document.
      connection.console.log(`${params.textDocument.uri} closed.`);
  });
  */

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
