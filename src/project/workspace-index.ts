/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { URI } from 'vscode-uri';
import { parseJava, type ParseResult } from '../java/parser.js';
import { buildSymbolTable, type SymbolTable, type JavaSymbol } from '../java/symbol-table.js';
import type { Logger } from '../utils/logger.js';

export interface IndexedFile {
    uri: string;
    filePath: string;
    parseResult?: ParseResult;
    symbolTable?: SymbolTable;
    lastModified: number;
}

export interface WorkspaceSymbolEntry {
    name: string;
    kind: JavaSymbol['kind'];
    uri: string;
    line: number;
    column: number;
    containerName?: string;
}

/**
 * Manages workspace-level Java file indexing and cross-file symbol resolution.
 */
export class WorkspaceIndex {
    private files: Map<string, IndexedFile> = new Map();
    private globalSymbols: WorkspaceSymbolEntry[] = [];
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Initialize the workspace index by scanning for Java files.
     */
    async initialize(rootUri: string | null | undefined): Promise<void> {
        if (!rootUri) return;

        try {
            const rootPath = URI.parse(rootUri).fsPath;
            this.logger.info(`Scanning workspace for Java files: ${rootPath}`);
            const javaFiles = await this.findJavaFiles(rootPath);
            this.logger.info(`Found ${javaFiles.length} Java file(s)`);

            for (const filePath of javaFiles) {
                await this.indexFile(filePath);
            }

            this.rebuildGlobalSymbols();
            this.logger.info(`Indexed ${this.globalSymbols.length} workspace symbol(s)`);
        } catch (e) {
            this.logger.warn(`Failed to scan workspace: ${e}`);
        }
    }

    /**
     * Update index for a single file (on open/change).
     */
    updateFile(uri: string, parseResult: ParseResult, symbolTable: SymbolTable): void {
        const filePath = URI.parse(uri).fsPath;
        this.files.set(uri, {
            uri,
            filePath,
            parseResult,
            symbolTable,
            lastModified: Date.now(),
        });
        this.rebuildGlobalSymbols();
    }

    /**
     * Remove a file from the index (on close/delete).
     */
    removeFile(uri: string): void {
        this.files.delete(uri);
        this.rebuildGlobalSymbols();
    }

    /**
     * Search for symbols across the workspace.
     */
    searchSymbols(query: string): WorkspaceSymbolEntry[] {
        if (!query) return this.globalSymbols.slice(0, 100);

        const lower = query.toLowerCase();
        return this.globalSymbols.filter(s =>
            s.name.toLowerCase().includes(lower),
        ).slice(0, 100);
    }

    /**
     * Find a type declaration by name across all files.
     */
    findTypeByName(name: string): WorkspaceSymbolEntry | undefined {
        return this.globalSymbols.find(s =>
            s.name === name && ['class', 'interface', 'enum', 'record'].includes(s.kind),
        );
    }

    /**
     * Find all declarations of a given name across all files.
     */
    findDeclarationsByName(name: string): WorkspaceSymbolEntry[] {
        return this.globalSymbols.filter(s => s.name === name);
    }

    /**
     * Get the symbol table for a specific file.
     */
    getSymbolTable(uri: string): SymbolTable | undefined {
        return this.files.get(uri)?.symbolTable;
    }

    /**
     * Get the parse result for a specific file.
     */
    getParseResult(uri: string): ParseResult | undefined {
        return this.files.get(uri)?.parseResult;
    }

    /**
     * Get all indexed file URIs.
     */
    getFileUris(): string[] {
        return Array.from(this.files.keys());
    }

    // --- Internal ---

    private async findJavaFiles(dir: string, maxDepth = 30): Promise<string[]> {
        if (maxDepth <= 0) return [];
        const files: string[] = [];

        try {
            const entries = await readdir(dir);
            for (const entry of entries) {
                if (entry === 'node_modules' || entry === '.git' || entry === 'target' ||
                    entry === 'build' || entry === '.gradle' || entry === '.mvn' ||
                    entry === 'bin' || entry === '.settings' || entry === '.idea') {
                    continue;
                }

                const fullPath = join(dir, entry);
                try {
                    const s = await stat(fullPath);
                    if (s.isDirectory()) {
                        const subFiles = await this.findJavaFiles(fullPath, maxDepth - 1);
                        files.push(...subFiles);
                    } else if (entry.endsWith('.java')) {
                        files.push(fullPath);
                    }
                } catch {
                    // Skip files we can't access
                }
            }
        } catch {
            // Skip directories we can't read
        }

        return files;
    }

    private async indexFile(filePath: string): Promise<void> {
        try {
            const content = await readFile(filePath, 'utf-8');
            const uri = URI.file(filePath).toString();
            const parseResult = parseJava(content);

            let symbolTable: SymbolTable | undefined;
            if (parseResult.cst) {
                symbolTable = buildSymbolTable(parseResult.cst);
            }

            this.files.set(uri, {
                uri,
                filePath,
                parseResult,
                symbolTable,
                lastModified: Date.now(),
            });
        } catch (e) {
            this.logger.log(`Failed to index ${filePath}: ${e}`);
        }
    }

    private rebuildGlobalSymbols(): void {
        this.globalSymbols = [];

        for (const [, file] of this.files) {
            if (!file.symbolTable) continue;

            for (const sym of file.symbolTable.allSymbols) {
                if (['class', 'interface', 'enum', 'record', 'method', 'field', 'constructor'].includes(sym.kind)) {
                    this.globalSymbols.push({
                        name: sym.name,
                        kind: sym.kind,
                        uri: file.uri,
                        line: sym.line,
                        column: sym.column,
                        containerName: sym.parent,
                    });
                }
            }
        }
    }
}
