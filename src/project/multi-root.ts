/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { WorkspaceFolder } from 'vscode-languageserver';
import { WorkspaceIndex, type WorkspaceSymbolEntry } from './workspace-index.js';
import type { Logger } from '../utils/logger.js';

/**
 * Multi-root workspace manager that tracks multiple workspace folders,
 * each with its own WorkspaceIndex.
 */
export class MultiRootWorkspace {
    private roots: Map<string, { folder: WorkspaceFolder; index: WorkspaceIndex }> = new Map();
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Initialize with workspace folders.
     */
    async initialize(folders: WorkspaceFolder[]): Promise<void> {
        for (const folder of folders) {
            await this.addFolder(folder);
        }
    }

    /**
     * Add a workspace folder.
     */
    async addFolder(folder: WorkspaceFolder): Promise<void> {
        if (this.roots.has(folder.uri)) {
            this.logger.info(`Workspace folder already registered: ${folder.uri}`);
            return;
        }

        const index = new WorkspaceIndex(this.logger);
        await index.initialize(folder.uri);
        this.roots.set(folder.uri, { folder, index });
        this.logger.info(`Added workspace folder: ${folder.name} (${folder.uri})`);
    }

    /**
     * Remove a workspace folder.
     */
    removeFolder(folderUri: string): void {
        if (this.roots.delete(folderUri)) {
            this.logger.info(`Removed workspace folder: ${folderUri}`);
        }
    }

    /**
     * Get the WorkspaceIndex for a given file URI by finding the longest
     * matching workspace folder prefix.
     */
    getIndexForFile(fileUri: string): WorkspaceIndex | undefined {
        let bestMatch: { folder: WorkspaceFolder; index: WorkspaceIndex } | undefined;
        let bestLength = 0;

        for (const [folderUri, root] of this.roots) {
            if (fileUri.startsWith(folderUri) && folderUri.length > bestLength) {
                bestMatch = root;
                bestLength = folderUri.length;
            }
        }

        return bestMatch?.index;
    }

    /**
     * Get all workspace indexes.
     */
    getAllIndexes(): WorkspaceIndex[] {
        return Array.from(this.roots.values()).map(r => r.index);
    }

    /**
     * Search symbols across all workspaces.
     */
    searchSymbols(query: string): Array<{ entry: WorkspaceSymbolEntry; workspaceFolder: string }> {
        const results: Array<{ entry: WorkspaceSymbolEntry; workspaceFolder: string }> = [];

        for (const [folderUri, root] of this.roots) {
            const entries = root.index.searchSymbols(query);
            for (const entry of entries) {
                results.push({ entry, workspaceFolder: folderUri });
            }
        }

        return results;
    }

    /**
     * Find type by name across all workspaces. Returns the first match.
     */
    findTypeByName(name: string): { entry: WorkspaceSymbolEntry; workspaceFolder: string } | undefined {
        for (const [folderUri, root] of this.roots) {
            const entry = root.index.findTypeByName(name);
            if (entry) {
                return { entry, workspaceFolder: folderUri };
            }
        }
        return undefined;
    }

    /**
     * Get all workspace folders.
     */
    getFolders(): WorkspaceFolder[] {
        return Array.from(this.roots.values()).map(r => r.folder);
    }
}
