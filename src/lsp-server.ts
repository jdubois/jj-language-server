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
import { computeSemanticDiagnostics } from './features/semantic-diagnostics.js';
import { extractDocumentSymbols } from './features/document-symbols.js';
import { computeFoldingRanges } from './features/folding-ranges.js';
import { formatDocument, formatRange } from './features/formatting.js';
import { provideHover } from './features/hover.js';
import { provideCompletions } from './features/completion.js';
import { provideSignatureHelp } from './features/signature-help.js';
import { provideDefinition, provideReferences, provideDocumentHighlight, provideRename, providePrepareRename, provideImplementation, provideTypeDefinition } from './features/navigation.js';
import { provideSelectionRanges } from './features/selection-range.js';
import { computeSemanticTokens, getSemanticTokensLegend } from './features/semantic-tokens.js';
import { getTokenAtPosition } from './features/token-utils.js';
import { provideCodeActions } from './features/code-actions.js';
import { provideSourceGenerationActions } from './features/source-generation.js';
import { organizeImports } from './features/organize-imports.js';
import { provideInlayHints } from './features/inlay-hints.js';
import { prepareCallHierarchy, provideIncomingCalls, provideOutgoingCalls } from './features/call-hierarchy.js';
import { prepareTypeHierarchy, provideSupertypes, provideSubtypes } from './features/type-hierarchy.js';
import { provideCodeLens } from './features/code-lens.js';
import { provideOnTypeFormatting } from './features/on-type-formatting.js';
import { WorkspaceIndex } from './project/workspace-index.js';
import { findJavadocComments } from './java/javadoc.js';

export interface JjLanguageServerSettings {
    java: {
        home?: string;
        version?: string;
    };
    formatting: {
        enabled: boolean;
        tabSize: number;
        insertSpaces: boolean;
    };
    diagnostics: {
        enabled: boolean;
        semanticEnabled: boolean;
    };
    completion: {
        autoImport: boolean;
    };
}

const DEFAULT_SETTINGS: JjLanguageServerSettings = {
    java: {},
    formatting: { enabled: true, tabSize: 4, insertSpaces: true },
    diagnostics: { enabled: true, semanticEnabled: true },
    completion: { autoImport: true },
};

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
    private workspaceIndex: WorkspaceIndex;
    private settings: JjLanguageServerSettings = { ...DEFAULT_SETTINGS };

    constructor(options: LspServerOptions) {
        this.logger = options.logger;
        this.lspClient = options.lspClient;
        this.workspaceIndex = new WorkspaceIndex(options.logger);
    }

    private rootUri: string | null = null;

    initialize(params: lsp.InitializeParams): lsp.InitializeResult {
        this.rootUri = params.rootUri ?? null;
        this.logger.info(`jj-language-server initializing for workspace: ${this.rootUri || 'no workspace'}`);

        return {
            capabilities: {
                textDocumentSync: lsp.TextDocumentSyncKind.Full,
                documentSymbolProvider: true,
                documentFormattingProvider: true,
                documentRangeFormattingProvider: true,
                documentOnTypeFormattingProvider: {
                    firstTriggerCharacter: '\n',
                    moreTriggerCharacter: ['}', ';'],
                },
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
                implementationProvider: true,
                typeDefinitionProvider: true,
                referencesProvider: true,
                documentHighlightProvider: true,
                renameProvider: {
                    prepareProvider: true,
                },
                selectionRangeProvider: true,
                codeActionProvider: {
                    codeActionKinds: [
                        lsp.CodeActionKind.QuickFix,
                        lsp.CodeActionKind.Refactor,
                        lsp.CodeActionKind.RefactorExtract,
                        lsp.CodeActionKind.SourceOrganizeImports,
                    ],
                },
                inlayHintProvider: true,
                callHierarchyProvider: true,
                typeHierarchyProvider: true,
                codeLensProvider: { resolveProvider: false },
                executeCommandProvider: undefined,
                workspaceSymbolProvider: true,
                semanticTokensProvider: {
                    legend: getSemanticTokensLegend(),
                    full: true,
                    range: true,
                },
                workspace: {
                    workspaceFolders: {
                        supported: true,
                    },
                },
            },
        };
    }

    async initialized(_params: lsp.InitializedParams): Promise<void> {
        this.logger.info('jj-language-server initialized');
        // Start workspace indexing in background
        await this.workspaceIndex.initialize(this.rootUri);
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
        this.workspaceIndex.removeFile(uri);
        this.lspClient.publishDiagnostics({ uri, diagnostics: [] });
    }

    didSaveTextDocument(_params: lsp.DidSaveTextDocumentParams): void {
        // No-op for now
    }

    didChangeWatchedFiles(params: lsp.DidChangeWatchedFilesParams): void {
        for (const change of params.changes) {
            const uri = change.uri;
            if (!uri.endsWith('.java')) continue;

            switch (change.type) {
                case lsp.FileChangeType.Created:
                case lsp.FileChangeType.Changed:
                    // Re-index the file
                    this.reindexFile(uri);
                    break;
                case lsp.FileChangeType.Deleted:
                    // Remove from index
                    this.workspaceIndex.removeFile(uri);
                    this.documents.delete(uri);
                    this.parseResults.delete(uri);
                    this.symbolTables.delete(uri);
                    break;
            }
        }
    }

    didChangeConfiguration(params: lsp.DidChangeConfigurationParams): void {
        const s = params.settings?.jjLanguageServer;
        if (s) {
            this.settings = {
                java: { ...DEFAULT_SETTINGS.java, ...s.java },
                formatting: { ...DEFAULT_SETTINGS.formatting, ...s.formatting },
                diagnostics: { ...DEFAULT_SETTINGS.diagnostics, ...s.diagnostics },
                completion: { ...DEFAULT_SETTINGS.completion, ...s.completion },
            };
            this.logger.info('Configuration updated');
        }
    }

    // --- Features (stubs for future phases) ---

    documentSymbol(params: lsp.DocumentSymbolParams): lsp.DocumentSymbol[] | null {
        const result = this.parseResults.get(params.textDocument.uri);
        if (!result?.cst) return null;
        return extractDocumentSymbols(result.cst);
    }

    async documentFormatting(params: lsp.DocumentFormattingParams): Promise<lsp.TextEdit[] | null> {
        if (!this.settings.formatting.enabled) return null;
        const document = this.documents.get(params.textDocument.uri);
        if (!document) return null;
        return formatDocument(document, params.options);
    }

    async documentRangeFormatting(params: lsp.DocumentRangeFormattingParams): Promise<lsp.TextEdit[] | null> {
        if (!this.settings.formatting.enabled) return null;
        const document = this.documents.get(params.textDocument.uri);
        if (!document) return null;
        return formatRange(document, params.range, params.options);
    }

    onTypeFormatting(params: lsp.DocumentOnTypeFormattingParams): lsp.TextEdit[] | null {
        if (!this.settings.formatting.enabled) return null;
        const doc = this.documents.get(params.textDocument.uri);
        if (!doc) return null;
        return provideOnTypeFormatting(doc.getText(), params.position, params.ch, params.options);
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
        const doc = this.documents.get(params.textDocument.uri);
        const text = doc?.getText();
        const result = this.parseResults.get(params.textDocument.uri);
        const javadocMap = result?.cst ? findJavadocComments(result.cst) : undefined;
        return provideCompletions(table, params.position.line, params.position.character, text, javadocMap);
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

        // Try local file first
        const localDef = provideDefinition(result.cst, table, uri, params.position.line, params.position.character);
        if (localDef) return localDef;

        // Try cross-file via workspace index
        const token = getTokenAtPosition(result.cst, params.position.line, params.position.character);
        if (token) {
            const entry = this.workspaceIndex.findTypeByName(token.image);
            if (entry) {
                return lsp.Location.create(
                    entry.uri,
                    lsp.Range.create(entry.line, entry.column, entry.line, entry.column + entry.name.length),
                );
            }
        }

        return null;
    }

    implementation(params: lsp.ImplementationParams): lsp.Location[] | null {
        const { uri } = params.textDocument;
        const result = this.parseResults.get(uri);
        const table = this.symbolTables.get(uri);
        if (!result?.cst || !table) return null;
        const locations = provideImplementation(result.cst, table, uri, params.position.line, params.position.character, this.workspaceIndex);
        return locations.length > 0 ? locations : null;
    }

    typeDefinition(params: lsp.TypeDefinitionParams): lsp.Location | null {
        const { uri } = params.textDocument;
        const result = this.parseResults.get(uri);
        const table = this.symbolTables.get(uri);
        if (!result?.cst || !table) return null;
        return provideTypeDefinition(result.cst, table, uri, params.position.line, params.position.character, this.workspaceIndex);
    }

    references(params: lsp.ReferenceParams): lsp.Location[] | null {
        const { uri } = params.textDocument;
        const result = this.parseResults.get(uri);
        const table = this.symbolTables.get(uri);
        if (!result?.cst || !table) return null;

        // Get local references
        const localRefs = provideReferences(result.cst, table, uri, params.position.line, params.position.character) ?? [];

        // Find the token at the cursor to get the symbol name
        const token = getTokenAtPosition(result.cst, params.position.line, params.position.character);
        if (!token) return localRefs.length > 0 ? localRefs : null;

        // Search other files for references to the same name
        const allRefs = [...localRefs];
        for (const fileUri of this.workspaceIndex.getFileUris()) {
            if (fileUri === uri) continue;
            const fileResult = this.workspaceIndex.getParseResult(fileUri);
            const fileTable = this.workspaceIndex.getSymbolTable(fileUri);
            if (!fileResult?.cst || !fileTable) continue;

            const fileRefs = provideReferences(fileResult.cst, fileTable, fileUri, -1, -1, token.image);
            if (fileRefs) allRefs.push(...fileRefs);
        }

        return allRefs.length > 0 ? allRefs : null;
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

        // Start with single-file rename
        const singleFile = provideRename(result.cst, table, uri, params.position.line, params.position.character, params.newName);
        if (!singleFile) return null;

        // Extend to cross-file rename via workspace index
        const token = getTokenAtPosition(result.cst, params.position.line, params.position.character);
        if (!token) return singleFile;

        const name = token.image;
        const allChanges: { [uri: string]: lsp.TextEdit[] } = { ...singleFile.changes };

        for (const fileUri of this.workspaceIndex.getFileUris()) {
            if (fileUri === uri) continue;
            const fileResult = this.workspaceIndex.getParseResult(fileUri);
            const fileTable = this.workspaceIndex.getSymbolTable(fileUri);
            if (!fileResult?.cst || !fileTable) continue;

            const refs = provideReferences(fileResult.cst, fileTable, fileUri, 0, 0, name);
            if (refs.length > 0) {
                allChanges[fileUri] = refs.map(ref =>
                    lsp.TextEdit.replace(ref.range, params.newName),
                );
            }
        }

        return { changes: allChanges };
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
        return provideSelectionRanges(result.cst, '', params.positions);
    }

    executeCommand(_params: lsp.ExecuteCommandParams): unknown {
        return null;
    }

    workspaceSymbol(params: lsp.WorkspaceSymbolParams): lsp.WorkspaceSymbol[] | null {
        const entries = this.workspaceIndex.searchSymbols(params.query);
        if (entries.length === 0) return null;

        const kindMap: Record<string, lsp.SymbolKind> = {
            class: lsp.SymbolKind.Class,
            interface: lsp.SymbolKind.Interface,
            enum: lsp.SymbolKind.Enum,
            record: lsp.SymbolKind.Struct,
            method: lsp.SymbolKind.Method,
            constructor: lsp.SymbolKind.Constructor,
            field: lsp.SymbolKind.Field,
        };

        return entries.map(entry => ({
            name: entry.name,
            kind: kindMap[entry.kind] ?? lsp.SymbolKind.Variable,
            location: lsp.Location.create(
                entry.uri,
                lsp.Range.create(entry.line, entry.column, entry.line, entry.column + entry.name.length),
            ),
            containerName: entry.containerName,
        }));
    }

    semanticTokensFull(params: lsp.SemanticTokensParams): lsp.SemanticTokens {
        const result = this.parseResults.get(params.textDocument.uri);
        if (!result?.cst) return { data: [] };
        const table = this.symbolTables.get(params.textDocument.uri);
        return computeSemanticTokens(result.cst, table);
    }

    semanticTokensRange(params: lsp.SemanticTokensRangeParams): lsp.SemanticTokens {
        // For now, return full tokens (range filtering can be optimized later)
        const result = this.parseResults.get(params.textDocument.uri);
        if (!result?.cst) return { data: [] };
        const table = this.symbolTables.get(params.textDocument.uri);
        return computeSemanticTokens(result.cst, table);
    }

    codeAction(params: lsp.CodeActionParams): lsp.CodeAction[] {
        const uri = params.textDocument.uri;
        const result = this.parseResults.get(uri);
        if (!result?.cst) return [];
        const table = this.symbolTables.get(uri);
        if (!table) return [];
        const doc = this.documents.get(uri);
        if (!doc) return [];
        const actions = provideCodeActions(result.cst, table, doc.getText(), uri, params.range, params.context);
        const genActions = provideSourceGenerationActions(table, doc.getText(), params.range, uri);
        return [...actions, ...genActions];
    }

    inlayHint(params: lsp.InlayHintParams): lsp.InlayHint[] {
        const result = this.parseResults.get(params.textDocument.uri);
        if (!result?.cst) return [];
        const table = this.symbolTables.get(params.textDocument.uri);
        if (!table) return [];
        return provideInlayHints(result.cst, table, params.range);
    }

    prepareCallHierarchy(params: lsp.CallHierarchyPrepareParams): lsp.CallHierarchyItem[] | null {
        const uri = params.textDocument.uri;
        const result = this.parseResults.get(uri);
        if (!result?.cst) return null;
        const table = this.symbolTables.get(uri);
        if (!table) return null;
        return prepareCallHierarchy(result.cst, table, uri, params.position.line, params.position.character);
    }

    callHierarchyIncomingCalls(params: lsp.CallHierarchyIncomingCallsParams): lsp.CallHierarchyIncomingCall[] {
        const uri = params.item.uri;
        const result = this.parseResults.get(uri);
        if (!result?.cst) return [];
        const table = this.symbolTables.get(uri);
        if (!table) return [];
        return provideIncomingCalls(result.cst, table, uri, params.item);
    }

    callHierarchyOutgoingCalls(params: lsp.CallHierarchyOutgoingCallsParams): lsp.CallHierarchyOutgoingCall[] {
        const uri = params.item.uri;
        const result = this.parseResults.get(uri);
        if (!result?.cst) return [];
        const table = this.symbolTables.get(uri);
        if (!table) return [];
        return provideOutgoingCalls(result.cst, table, uri, params.item);
    }

    prepareTypeHierarchy(params: lsp.TypeHierarchyPrepareParams): lsp.TypeHierarchyItem[] | null {
        const uri = params.textDocument.uri;
        const table = this.symbolTables.get(uri);
        if (!table) return null;
        return prepareTypeHierarchy(table, uri, params.position.line, params.position.character);
    }

    typeHierarchySupertypes(params: lsp.TypeHierarchySupertypesParams): lsp.TypeHierarchyItem[] {
        const uri = params.item.uri;
        const table = this.symbolTables.get(uri);
        if (!table) return [];
        return provideSupertypes(table, uri, params.item, this.workspaceIndex);
    }

    typeHierarchySubtypes(params: lsp.TypeHierarchySubtypesParams): lsp.TypeHierarchyItem[] {
        const uri = params.item.uri;
        const table = this.symbolTables.get(uri);
        if (!table) return [];
        return provideSubtypes(table, uri, params.item, this.workspaceIndex);
    }

    codeLens(params: lsp.CodeLensParams): lsp.CodeLens[] {
        const uri = params.textDocument.uri;
        const result = this.parseResults.get(uri);
        if (!result?.cst) return [];
        const table = this.symbolTables.get(uri);
        if (!table) return [];
        return provideCodeLens(result.cst, table, uri);
    }

    // --- Internal ---

    private async reindexFile(uri: string): Promise<void> {
        try {
            const { readFile } = await import('node:fs/promises');
            const { URI } = await import('vscode-uri');
            const filePath = URI.parse(uri).fsPath;
            const text = await readFile(filePath, 'utf-8');
            const result = parseJava(text);
            if (result.cst) {
                this.parseResults.set(uri, result);
                const table = buildSymbolTable(result.cst);
                this.symbolTables.set(uri, table);
                this.workspaceIndex.updateFile(uri, result, table);
            }
        } catch (e) {
            this.logger.warn(`Failed to reindex ${uri}: ${e}`);
        }
    }

    private parseAndPublishDiagnostics(uri: string, text: string): void {
        const result = parseJava(text);
        this.parseResults.set(uri, result);

        // Build symbol table if parsing produced a CST
        if (result.cst) {
            const table = buildSymbolTable(result.cst);
            this.symbolTables.set(uri, table);
            // Update workspace index
            this.workspaceIndex.updateFile(uri, result, table);
        }

        const parseDiagnostics = parseErrorsToDiagnostics(result.errors);

        // Run semantic checks if we have a valid CST and symbol table
        let semanticDiagnostics: ReturnType<typeof computeSemanticDiagnostics> = [];
        if (this.settings.diagnostics.semanticEnabled && result.cst && result.errors.length === 0) {
            const table = this.symbolTables.get(uri);
            if (table) {
                semanticDiagnostics = computeSemanticDiagnostics(result.cst, table, text);
            }
        }

        if (!this.settings.diagnostics.enabled) {
            this.lspClient.publishDiagnostics({ uri, diagnostics: [] });
        } else {
            const diagnostics = [...parseDiagnostics, ...semanticDiagnostics];
            this.lspClient.publishDiagnostics({ uri, diagnostics });
        }

        if (result.errors.length > 0) {
            this.logger.log(`Parsed ${uri}: ${result.errors.length} error(s)`);
        }
    }
}
