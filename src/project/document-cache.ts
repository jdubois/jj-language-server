/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { ParseResult } from '../java/parser.js';
import type { SymbolTable } from '../java/symbol-table.js';

export interface CachedDocument {
    uri: string;
    version: number;
    content: string;
    parseResult: ParseResult;
    symbolTable: SymbolTable;
    lastParsed: number;
    isDirty: boolean;
}

/**
 * Smart document cache that tracks document versions and avoids unnecessary reparsing.
 */
export class DocumentCache {
    private cache: Map<string, CachedDocument> = new Map();
    private parseDebounceTimers: Map<string, NodeJS.Timeout> = new Map();

    /**
     * Get cached document. If version is provided, only returns when version matches.
     */
    get(uri: string, version?: number): CachedDocument | undefined {
        const cached = this.cache.get(uri);
        if (!cached) return undefined;
        if (version !== undefined && cached.version !== version) return undefined;
        return cached;
    }

    /**
     * Update document content. Returns true if content actually changed.
     */
    update(
        uri: string,
        version: number,
        content: string,
        parseResult: ParseResult,
        symbolTable: SymbolTable,
    ): boolean {
        const existing = this.cache.get(uri);
        if (existing && existing.content === content && existing.version === version) {
            return false;
        }

        this.cache.set(uri, {
            uri,
            version,
            content,
            parseResult,
            symbolTable,
            lastParsed: Date.now(),
            isDirty: false,
        });
        return true;
    }

    /**
     * Mark document as dirty (needs reparse).
     */
    markDirty(uri: string): void {
        const cached = this.cache.get(uri);
        if (cached) {
            cached.isDirty = true;
        }
    }

    /**
     * Remove document from cache.
     */
    remove(uri: string): void {
        this.cancelReparse(uri);
        this.cache.delete(uri);
    }

    /**
     * Get all cached URIs.
     */
    getUris(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * Get cache size.
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Clear entire cache.
     */
    clear(): void {
        for (const uri of this.parseDebounceTimers.keys()) {
            this.cancelReparse(uri);
        }
        this.cache.clear();
    }

    /**
     * Schedule a debounced reparse. Cancels any previously scheduled reparse for the same URI.
     */
    scheduleReparse(
        uri: string,
        content: string,
        delayMs: number,
        parseFn: (content: string) => { parseResult: ParseResult; symbolTable: SymbolTable },
    ): void {
        this.cancelReparse(uri);

        const timer = setTimeout(() => {
            this.parseDebounceTimers.delete(uri);
            const { parseResult, symbolTable } = parseFn(content);
            const cached = this.cache.get(uri);
            const version = cached ? cached.version : 0;
            this.update(uri, version, content, parseResult, symbolTable);
        }, delayMs);

        this.parseDebounceTimers.set(uri, timer);
    }

    /**
     * Cancel any pending reparse for a URI.
     */
    cancelReparse(uri: string): void {
        const timer = this.parseDebounceTimers.get(uri);
        if (timer) {
            clearTimeout(timer);
            this.parseDebounceTimers.delete(uri);
        }
    }
}
