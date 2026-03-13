/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiRootWorkspace } from './multi-root.js';
import type { WorkspaceFolder } from 'vscode-languageserver';
import type { Logger } from '../utils/logger.js';

// Stub WorkspaceIndex.initialize to avoid filesystem access
vi.mock('./workspace-index.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./workspace-index.js')>();
    return {
        ...actual,
        WorkspaceIndex: class MockWorkspaceIndex {
            private logger: Logger;
            private symbols: Array<{ name: string; kind: string; uri: string; line: number; column: number; containerName?: string }> = [];

            constructor(logger: Logger) {
                this.logger = logger;
            }

            async initialize(_rootUri: string | null | undefined): Promise<void> {
                // no-op: skip filesystem scanning in tests
            }

            updateFile(): void {}
            removeFile(): void {}

            searchSymbols(query: string) {
                if (!query) return this.symbols.slice(0, 100);
                const lower = query.toLowerCase();
                return this.symbols.filter(s => s.name.toLowerCase().includes(lower)).slice(0, 100);
            }

            findTypeByName(name: string) {
                return this.symbols.find(
                    s => s.name === name && ['class', 'interface', 'enum', 'record'].includes(s.kind),
                );
            }

            findDeclarationsByName(name: string) {
                return this.symbols.filter(s => s.name === name);
            }

            getFileUris(): string[] {
                return [];
            }

            // Test helper: inject symbols for testing cross-workspace search
            _addTestSymbol(sym: { name: string; kind: string; uri: string; line: number; column: number; containerName?: string }) {
                this.symbols.push(sym);
            }
        },
    };
});

function makeLogger(): Logger {
    return {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        log: vi.fn(),
    };
}

function makeFolder(name: string, uri: string): WorkspaceFolder {
    return { name, uri };
}

describe('MultiRootWorkspace', () => {
    let workspace: MultiRootWorkspace;
    let logger: Logger;

    beforeEach(() => {
        logger = makeLogger();
        workspace = new MultiRootWorkspace(logger);
    });

    describe('initialize', () => {
        it('should handle empty folders array', async () => {
            await workspace.initialize([]);
            expect(workspace.getFolders()).toHaveLength(0);
            expect(workspace.getAllIndexes()).toHaveLength(0);
        });

        it('should initialize with multiple folders', async () => {
            await workspace.initialize([
                makeFolder('project-a', 'file:///workspace/project-a'),
                makeFolder('project-b', 'file:///workspace/project-b'),
            ]);

            expect(workspace.getFolders()).toHaveLength(2);
            expect(workspace.getAllIndexes()).toHaveLength(2);
        });
    });

    describe('addFolder / removeFolder', () => {
        it('should add a workspace folder', async () => {
            await workspace.addFolder(makeFolder('app', 'file:///workspace/app'));

            expect(workspace.getFolders()).toHaveLength(1);
            expect(workspace.getFolders()[0].name).toBe('app');
        });

        it('should not duplicate an already registered folder', async () => {
            const folder = makeFolder('app', 'file:///workspace/app');
            await workspace.addFolder(folder);
            await workspace.addFolder(folder);

            expect(workspace.getFolders()).toHaveLength(1);
        });

        it('should remove a workspace folder', async () => {
            await workspace.addFolder(makeFolder('app', 'file:///workspace/app'));
            workspace.removeFolder('file:///workspace/app');

            expect(workspace.getFolders()).toHaveLength(0);
            expect(workspace.getAllIndexes()).toHaveLength(0);
        });

        it('should not throw when removing unknown folder', () => {
            expect(() => workspace.removeFolder('file:///unknown')).not.toThrow();
        });
    });

    describe('getIndexForFile', () => {
        it('should return the correct index for a file inside a workspace', async () => {
            await workspace.addFolder(makeFolder('app', 'file:///workspace/app'));

            const index = workspace.getIndexForFile('file:///workspace/app/src/Main.java');
            expect(index).toBeDefined();
            expect(index).toBeInstanceOf(Object);
        });

        it('should return undefined for a file outside any workspace', async () => {
            await workspace.addFolder(makeFolder('app', 'file:///workspace/app'));

            const index = workspace.getIndexForFile('file:///other/location/Main.java');
            expect(index).toBeUndefined();
        });

        it('should return the most specific (longest prefix) workspace', async () => {
            await workspace.addFolder(makeFolder('root', 'file:///workspace'));
            await workspace.addFolder(makeFolder('nested', 'file:///workspace/nested'));

            const index = workspace.getIndexForFile('file:///workspace/nested/src/Main.java');
            // Should match the nested workspace, not the root
            const allIndexes = workspace.getAllIndexes();
            expect(index).toBe(allIndexes[1]);
        });
    });

    describe('searchSymbols', () => {
        it('should return empty results when no folders exist', () => {
            const results = workspace.searchSymbols('Foo');
            expect(results).toHaveLength(0);
        });

        it('should search across multiple workspaces', async () => {
            await workspace.addFolder(makeFolder('proj-a', 'file:///workspace/proj-a'));
            await workspace.addFolder(makeFolder('proj-b', 'file:///workspace/proj-b'));

            // Inject test symbols into each index
            const indexes = workspace.getAllIndexes();
            (indexes[0] as any)._addTestSymbol({
                name: 'FooService',
                kind: 'class',
                uri: 'file:///workspace/proj-a/src/FooService.java',
                line: 0,
                column: 0,
            });
            (indexes[1] as any)._addTestSymbol({
                name: 'FooController',
                kind: 'class',
                uri: 'file:///workspace/proj-b/src/FooController.java',
                line: 0,
                column: 0,
            });

            const results = workspace.searchSymbols('Foo');
            expect(results).toHaveLength(2);
            expect(results[0].entry.name).toBe('FooService');
            expect(results[0].workspaceFolder).toBe('file:///workspace/proj-a');
            expect(results[1].entry.name).toBe('FooController');
            expect(results[1].workspaceFolder).toBe('file:///workspace/proj-b');
        });
    });

    describe('findTypeByName', () => {
        it('should return undefined when no type matches', async () => {
            await workspace.addFolder(makeFolder('proj', 'file:///workspace/proj'));

            expect(workspace.findTypeByName('NonExistent')).toBeUndefined();
        });

        it('should find a type across workspaces', async () => {
            await workspace.addFolder(makeFolder('proj-a', 'file:///workspace/proj-a'));
            await workspace.addFolder(makeFolder('proj-b', 'file:///workspace/proj-b'));

            const indexes = workspace.getAllIndexes();
            (indexes[1] as any)._addTestSymbol({
                name: 'UserEntity',
                kind: 'class',
                uri: 'file:///workspace/proj-b/src/UserEntity.java',
                line: 5,
                column: 0,
            });

            const result = workspace.findTypeByName('UserEntity');
            expect(result).toBeDefined();
            expect(result!.entry.name).toBe('UserEntity');
            expect(result!.workspaceFolder).toBe('file:///workspace/proj-b');
        });

        it('should return the first matching type when multiple workspaces have it', async () => {
            await workspace.addFolder(makeFolder('proj-a', 'file:///workspace/proj-a'));
            await workspace.addFolder(makeFolder('proj-b', 'file:///workspace/proj-b'));

            const indexes = workspace.getAllIndexes();
            (indexes[0] as any)._addTestSymbol({
                name: 'Config',
                kind: 'class',
                uri: 'file:///workspace/proj-a/src/Config.java',
                line: 0,
                column: 0,
            });
            (indexes[1] as any)._addTestSymbol({
                name: 'Config',
                kind: 'class',
                uri: 'file:///workspace/proj-b/src/Config.java',
                line: 0,
                column: 0,
            });

            const result = workspace.findTypeByName('Config');
            expect(result).toBeDefined();
            expect(result!.workspaceFolder).toBe('file:///workspace/proj-a');
        });
    });
});
