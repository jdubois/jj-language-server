/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { LspClient } from './lsp-client.js';
import type { Logger } from './utils/logger.js';
import { parseJava, type ParseResult } from './java/parser.js';
import { parseErrorsToDiagnostics } from './diagnostics.js';

export interface LspServerOptions {
    logger: Logger;
    lspClient: LspClient;
}

export class LspServer {
    private logger: Logger;
    private lspClient: LspClient;
    private documents: Map<string, TextDocument> = new Map();
    private parseResults: Map<string, ParseResult> = new Map();

    constructor(options: LspServerOptions) {
        this.logger = options.logger;
        this.lspClient = options.lspClient;
    }

    initialize(params: lsp.InitializeParams): lsp.InitializeResult {
        this.logger.info(`jj-language-server initializing for workspace: ${params.rootUri || 'no workspace'}`);

        return {
            capabilities: {
                textDocumentSync: lsp.TextDocumentSyncKind.Full,
                documentSymbolProvider: false,
                documentFormattingProvider: false,
                documentRangeFormattingProvider: false,
                foldingRangeProvider: false,
                hoverProvider: false,
                completionProvider: undefined,
                signatureHelpProvider: undefined,
                definitionProvider: false,
                referencesProvider: false,
                documentHighlightProvider: false,
                renameProvider: false,
                selectionRangeProvider: false,
                codeActionProvider: false,
                executeCommandProvider: undefined,
                workspaceSymbolProvider: false,
                semanticTokensProvider: undefined,
            },
        };
    }

    initialized(_params: lsp.InitializedParams): void {
        this.logger.info('jj-language-server initialized');
    }

    shutdown(): void {
        this.logger.info('jj-language-server shutting down');
        this.documents.clear();
        this.parseResults.clear();
    }

    // --- Text Document Synchronization ---

    didOpenTextDocument(params: lsp.DidOpenTextDocumentParams): void {
        const { uri, languageId, version, text } = params.textDocument;
        if (languageId !== 'java') {
            return;
        }
        const document = TextDocument.create(uri, languageId, version, text);
        this.documents.set(uri, document);
        this.parseAndPublishDiagnostics(uri, text);
    }

    didChangeTextDocument(params: lsp.DidChangeTextDocumentParams): void {
        const { uri, version } = params.textDocument;
        const existing = this.documents.get(uri);
        if (!existing) {
            return;
        }
        const updated = TextDocument.update(existing, params.contentChanges, version);
        this.documents.set(uri, updated);
        this.parseAndPublishDiagnostics(uri, updated.getText());
    }

    didCloseTextDocument(params: lsp.DidCloseTextDocumentParams): void {
        const { uri } = params.textDocument;
        this.documents.delete(uri);
        this.parseResults.delete(uri);
        this.lspClient.publishDiagnostics({ uri, diagnostics: [] });
    }

    didSaveTextDocument(_params: lsp.DidSaveTextDocumentParams): void {
        // No-op for now
    }

    // --- Features (stubs for future phases) ---

    documentSymbol(_params: lsp.DocumentSymbolParams): lsp.DocumentSymbol[] | null {
        return null;
    }

    documentFormatting(_params: lsp.DocumentFormattingParams): lsp.TextEdit[] | null {
        return null;
    }

    documentRangeFormatting(_params: lsp.DocumentRangeFormattingParams): lsp.TextEdit[] | null {
        return null;
    }

    foldingRanges(_params: lsp.FoldingRangeParams): lsp.FoldingRange[] | null {
        return null;
    }

    hover(_params: lsp.HoverParams): lsp.Hover | null {
        return null;
    }

    completion(_params: lsp.CompletionParams): lsp.CompletionItem[] | null {
        return null;
    }

    completionResolve(item: lsp.CompletionItem): lsp.CompletionItem {
        return item;
    }

    signatureHelp(_params: lsp.SignatureHelpParams): lsp.SignatureHelp | null {
        return null;
    }

    definition(_params: lsp.DefinitionParams): lsp.Definition | null {
        return null;
    }

    references(_params: lsp.ReferenceParams): lsp.Location[] | null {
        return null;
    }

    documentHighlight(_params: lsp.DocumentHighlightParams): lsp.DocumentHighlight[] | null {
        return null;
    }

    rename(_params: lsp.RenameParams): lsp.WorkspaceEdit | null {
        return null;
    }

    prepareRename(_params: lsp.PrepareRenameParams): lsp.Range | null {
        return null;
    }

    selectionRanges(_params: lsp.SelectionRangeParams): lsp.SelectionRange[] | null {
        return null;
    }

    codeAction(_params: lsp.CodeActionParams): lsp.CodeAction[] | null {
        return null;
    }

    executeCommand(_params: lsp.ExecuteCommandParams): unknown {
        return null;
    }

    workspaceSymbol(_params: lsp.WorkspaceSymbolParams): lsp.WorkspaceSymbol[] | null {
        return null;
    }

    semanticTokensFull(_params: lsp.SemanticTokensParams): lsp.SemanticTokens {
        return { data: [] };
    }

    semanticTokensRange(_params: lsp.SemanticTokensRangeParams): lsp.SemanticTokens {
        return { data: [] };
    }

    // --- Internal ---

    private parseAndPublishDiagnostics(uri: string, text: string): void {
        const result = parseJava(text);
        this.parseResults.set(uri, result);

        const diagnostics = parseErrorsToDiagnostics(result.errors);
        this.lspClient.publishDiagnostics({ uri, diagnostics });

        if (result.errors.length > 0) {
            this.logger.log(`Parsed ${uri}: ${result.errors.length} error(s)`);
        }
    }
}
