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
import { buildSymbolTable, type SymbolTable } from './java/symbol-table.js';
import { parseErrorsToDiagnostics } from './diagnostics.js';
import { extractDocumentSymbols } from './features/document-symbols.js';
import { computeFoldingRanges } from './features/folding-ranges.js';
import { formatDocument, formatRange } from './features/formatting.js';
import { provideHover } from './features/hover.js';
import { provideCompletions } from './features/completion.js';
import { provideSignatureHelp } from './features/signature-help.js';
import { provideDefinition, provideReferences, provideDocumentHighlight, provideRename, providePrepareRename } from './features/navigation.js';
import { provideSelectionRanges } from './features/selection-range.js';
import { computeSemanticTokens, getSemanticTokensLegend } from './features/semantic-tokens.js';

export interface LspServerOptions {
    logger: Logger;
    lspClient: LspClient;
}

export class LspServer {
    private logger: Logger;
    private lspClient: LspClient;
    private documents: Map<string, TextDocument> = new Map();
    private parseResults: Map<string, ParseResult> = new Map();
    private symbolTables: Map<string, SymbolTable> = new Map();

    constructor(options: LspServerOptions) {
        this.logger = options.logger;
        this.lspClient = options.lspClient;
    }

    initialize(params: lsp.InitializeParams): lsp.InitializeResult {
        this.logger.info(`jj-language-server initializing for workspace: ${params.rootUri || 'no workspace'}`);

        return {
            capabilities: {
                textDocumentSync: lsp.TextDocumentSyncKind.Full,
                documentSymbolProvider: true,
                documentFormattingProvider: true,
                documentRangeFormattingProvider: true,
                foldingRangeProvider: true,
                hoverProvider: true,
                completionProvider: {
                    triggerCharacters: ['.', '@'],
                    resolveProvider: true,
                },
                signatureHelpProvider: {
                    triggerCharacters: ['(', ','],
                },
                definitionProvider: true,
                referencesProvider: true,
                documentHighlightProvider: true,
                renameProvider: {
                    prepareProvider: true,
                },
                selectionRangeProvider: true,
                codeActionProvider: false,
                executeCommandProvider: undefined,
                workspaceSymbolProvider: false,
                semanticTokensProvider: {
                    legend: getSemanticTokensLegend(),
                    full: true,
                    range: true,
                },
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
        this.symbolTables.clear();
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
        this.symbolTables.delete(uri);
        this.lspClient.publishDiagnostics({ uri, diagnostics: [] });
    }

    didSaveTextDocument(_params: lsp.DidSaveTextDocumentParams): void {
        // No-op for now
    }

    // --- Features (stubs for future phases) ---

    documentSymbol(params: lsp.DocumentSymbolParams): lsp.DocumentSymbol[] | null {
        const result = this.parseResults.get(params.textDocument.uri);
        if (!result?.cst) return null;
        return extractDocumentSymbols(result.cst);
    }

    async documentFormatting(params: lsp.DocumentFormattingParams): Promise<lsp.TextEdit[] | null> {
        const document = this.documents.get(params.textDocument.uri);
        if (!document) return null;
        return formatDocument(document, params.options);
    }

    async documentRangeFormatting(params: lsp.DocumentRangeFormattingParams): Promise<lsp.TextEdit[] | null> {
        const document = this.documents.get(params.textDocument.uri);
        if (!document) return null;
        return formatRange(document, params.range, params.options);
    }

    foldingRanges(params: lsp.FoldingRangeParams): lsp.FoldingRange[] | null {
        const result = this.parseResults.get(params.textDocument.uri);
        const document = this.documents.get(params.textDocument.uri);
        if (!result?.cst || !document) return null;
        return computeFoldingRanges(result.cst, document.getText());
    }

    hover(params: lsp.HoverParams): lsp.Hover | null {
        const { uri } = params.textDocument;
        const result = this.parseResults.get(uri);
        const table = this.symbolTables.get(uri);
        const document = this.documents.get(uri);
        if (!result?.cst || !table || !document) return null;
        return provideHover(result.cst, table, document.getText(), params.position.line, params.position.character);
    }

    completion(params: lsp.CompletionParams): lsp.CompletionItem[] | null {
        const table = this.symbolTables.get(params.textDocument.uri);
        if (!table) return null;
        return provideCompletions(table, params.position.line, params.position.character);
    }

    completionResolve(item: lsp.CompletionItem): lsp.CompletionItem {
        return item;
    }

    signatureHelp(params: lsp.SignatureHelpParams): lsp.SignatureHelp | null {
        const table = this.symbolTables.get(params.textDocument.uri);
        const document = this.documents.get(params.textDocument.uri);
        if (!table || !document) return null;
        return provideSignatureHelp(table, document.getText(), params.position.line, params.position.character);
    }

    definition(params: lsp.DefinitionParams): lsp.Definition | null {
        const { uri } = params.textDocument;
        const result = this.parseResults.get(uri);
        const table = this.symbolTables.get(uri);
        if (!result?.cst || !table) return null;
        return provideDefinition(result.cst, table, uri, params.position.line, params.position.character);
    }

    references(params: lsp.ReferenceParams): lsp.Location[] | null {
        const { uri } = params.textDocument;
        const result = this.parseResults.get(uri);
        const table = this.symbolTables.get(uri);
        if (!result?.cst || !table) return null;
        return provideReferences(result.cst, table, uri, params.position.line, params.position.character);
    }

    documentHighlight(params: lsp.DocumentHighlightParams): lsp.DocumentHighlight[] | null {
        const { uri } = params.textDocument;
        const result = this.parseResults.get(uri);
        const table = this.symbolTables.get(uri);
        if (!result?.cst || !table) return null;
        return provideDocumentHighlight(result.cst, table, params.position.line, params.position.character);
    }

    rename(params: lsp.RenameParams): lsp.WorkspaceEdit | null {
        const { uri } = params.textDocument;
        const result = this.parseResults.get(uri);
        const table = this.symbolTables.get(uri);
        if (!result?.cst || !table) return null;
        return provideRename(result.cst, table, uri, params.position.line, params.position.character, params.newName);
    }

    prepareRename(params: lsp.PrepareRenameParams): lsp.Range | null {
        const { uri } = params.textDocument;
        const result = this.parseResults.get(uri);
        const table = this.symbolTables.get(uri);
        if (!result?.cst || !table) return null;
        return providePrepareRename(result.cst, table, params.position.line, params.position.character);
    }

    selectionRanges(params: lsp.SelectionRangeParams): lsp.SelectionRange[] | null {
        const result = this.parseResults.get(params.textDocument.uri);
        if (!result?.cst) return null;
        return provideSelectionRanges(result.cst, params.positions);
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

    semanticTokensFull(params: lsp.SemanticTokensParams): lsp.SemanticTokens {
        const result = this.parseResults.get(params.textDocument.uri);
        if (!result?.cst) return { data: [] };
        return computeSemanticTokens(result.cst);
    }

    semanticTokensRange(params: lsp.SemanticTokensRangeParams): lsp.SemanticTokens {
        // For now, return full tokens (range filtering can be optimized later)
        const result = this.parseResults.get(params.textDocument.uri);
        if (!result?.cst) return { data: [] };
        return computeSemanticTokens(result.cst);
    }

    // --- Internal ---

    private parseAndPublishDiagnostics(uri: string, text: string): void {
        const result = parseJava(text);
        this.parseResults.set(uri, result);

        // Build symbol table if parsing produced a CST
        if (result.cst) {
            const table = buildSymbolTable(result.cst);
            this.symbolTables.set(uri, table);
        }

        const diagnostics = parseErrorsToDiagnostics(result.errors);
        this.lspClient.publishDiagnostics({ uri, diagnostics });

        if (result.errors.length > 0) {
            this.logger.log(`Parsed ${uri}: ${result.errors.length} error(s)`);
        }
    }
}
