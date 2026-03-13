/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Logger } from '../utils/logger.js';
import type { ParseResult } from '../java/parser.js';
import type { SymbolTable } from '../java/symbol-table.js';
import { parseJava } from '../java/parser.js';
import { buildSymbolTable } from '../java/symbol-table.js';
import { parseZipEntries, extractEntry } from './jar-index.js';

export interface SourceEntry {
    qualifiedName: string;
    sourceText: string;
    parseResult: ParseResult;
    symbolTable: SymbolTable;
}

export interface SourceJarInfo {
    jarPath: string;
    groupId: string;
    artifactId: string;
    version: string;
}

/**
 * Manages source JAR extraction, parsing, and caching for go-to-definition
 * into dependency sources.
 */
export class SourceJarCache {
    private cache: Map<string, SourceEntry> = new Map();
    private jarPaths: Map<string, string> = new Map();
    private logger: Logger;
    private loadedJars: Set<string> = new Set();

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Register source JARs from resolved classpath.
     * This just stores the JAR paths; actual extraction is lazy (on demand).
     */
    registerSourceJars(jars: SourceJarInfo[]): void {
        for (const jar of jars) {
            if (existsSync(jar.jarPath)) {
                this.jarPaths.set(`${jar.groupId}:${jar.artifactId}:${jar.version}`, jar.jarPath);
            }
        }
        this.logger.info(`Registered ${this.jarPaths.size} source JARs`);
    }

    /**
     * Find source for a fully qualified type name.
     * Returns the parsed source entry, or undefined if not available.
     * Lazy-loads from source JAR on first access.
     */
    async findSource(qualifiedName: string): Promise<SourceEntry | undefined> {
        const cached = this.cache.get(qualifiedName);
        if (cached) return cached;

        // Convert qualified name to path: java.util.ArrayList → java/util/ArrayList.java
        const relativePath = qualifiedName.replace(/\./g, '/') + '.java';

        for (const [, jarPath] of this.jarPaths.entries()) {
            if (this.loadedJars.has(jarPath)) continue;

            const entry = await this.extractFromJar(jarPath, relativePath);
            if (entry) {
                this.cache.set(qualifiedName, entry);
                return entry;
            }
        }

        return undefined;
    }

    /**
     * Eagerly index an entire source JAR (extract and parse all .java files).
     * Useful for preloading commonly-used dependencies.
     */
    async indexSourceJar(jarPath: string): Promise<number> {
        if (this.loadedJars.has(jarPath)) return 0;

        try {
            const buf = await readFile(jarPath);
            const entries = parseZipEntries(buf);
            let count = 0;

            for (const zipEntry of entries) {
                if (!zipEntry.fileName.endsWith('.java')) continue;
                if (zipEntry.fileName.includes('package-info.java')) continue;
                if (zipEntry.fileName.includes('module-info.java')) continue;

                const data = extractEntry(buf, zipEntry);
                if (!data) continue;

                const sourceText = data.toString('utf-8');
                const qualifiedName = zipEntry.fileName
                    .replace(/\.java$/, '')
                    .replace(/\//g, '.');

                try {
                    const parseResult = parseJava(sourceText);
                    if (parseResult.cst) {
                        const symbolTable = buildSymbolTable(parseResult.cst);
                        this.cache.set(qualifiedName, {
                            qualifiedName,
                            sourceText,
                            parseResult,
                            symbolTable,
                        });
                        count++;
                    }
                } catch {
                    // Skip files that fail to parse
                }
            }

            this.loadedJars.add(jarPath);
            this.logger.info(`Indexed ${count} source files from ${jarPath}`);
            return count;
        } catch (e) {
            this.logger.warn(`Failed to index source JAR ${jarPath}: ${e}`);
            return 0;
        }
    }

    /**
     * Extract a single file from a JAR.
     */
    private async extractFromJar(jarPath: string, relativePath: string): Promise<SourceEntry | undefined> {
        try {
            const buf = await readFile(jarPath);
            const entries = parseZipEntries(buf);

            const zipEntry = entries.find(e => e.fileName === relativePath);
            if (!zipEntry) return undefined;

            const data = extractEntry(buf, zipEntry);
            if (!data) return undefined;

            const sourceText = data.toString('utf-8');
            const qualifiedName = relativePath.replace(/\.java$/, '').replace(/\//g, '.');
            const parseResult = parseJava(sourceText);

            if (!parseResult.cst) return undefined;

            const symbolTable = buildSymbolTable(parseResult.cst);
            return { qualifiedName, sourceText, parseResult, symbolTable };
        } catch {
            return undefined;
        }
    }

    /**
     * Create a virtual URI for a source JAR entry.
     * Format: jj-source-jar:///path/to/Class.java
     */
    static createVirtualUri(qualifiedName: string): string {
        const path = qualifiedName.replace(/\./g, '/');
        return `jj-source-jar:///${path}.java`;
    }

    /**
     * Check if a URI is a virtual source JAR URI.
     */
    static isVirtualUri(uri: string): boolean {
        return uri.startsWith('jj-source-jar:///');
    }

    /**
     * Extract the qualified name from a virtual URI.
     */
    static qualifiedNameFromUri(uri: string): string {
        return uri.replace('jj-source-jar:///', '').replace(/\.java$/, '').replace(/\//g, '.');
    }

    get size(): number {
        return this.cache.size;
    }

    clear(): void {
        this.cache.clear();
        this.loadedJars.clear();
    }
}
