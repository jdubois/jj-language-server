/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { prepareTypeHierarchy, provideSupertypes, provideSubtypes } from './type-hierarchy.js';
import { parseJava } from '../java/parser.js';
import { buildSymbolTable } from '../java/symbol-table.js';
import { WorkspaceIndex } from '../project/workspace-index.js';
import lsp from 'vscode-languageserver';

const TEST_URI = 'file:///test/Test.java';

const noopLogger = {
    info: () => {},
    warn: () => {},
    log: () => {},
    error: () => {},
};

const code = `public interface Animal {
    String getName();
}
public interface Pet extends Animal {
    String getOwner();
}
public class Dog implements Pet {
    private String name;
    public String getName() { return name; }
    public String getOwner() { return "owner"; }
}
public class Puppy extends Dog {
    private int age;
}`;

function setup(source: string) {
    const result = parseJava(source);
    if (!result.cst) throw new Error('Parse failed');
    const table = buildSymbolTable(result.cst);
    return { cst: result.cst, table };
}

function indexContent(wi: WorkspaceIndex, uri: string, source: string) {
    const result = parseJava(source);
    if (result.cst) {
        const table = buildSymbolTable(result.cst);
        wi.updateFile(uri, result, table);
    }
}

function makeItem(name: string, kind: lsp.SymbolKind, uri: string): lsp.TypeHierarchyItem {
    return {
        name,
        kind,
        uri,
        range: lsp.Range.create(0, 0, 0, 0),
        selectionRange: lsp.Range.create(0, 0, 0, 0),
    };
}

describe('type-hierarchy', () => {
    const { table } = setup(code);

    describe('prepareTypeHierarchy', () => {
        it('finds the type at cursor position', () => {
            const items = prepareTypeHierarchy(table, TEST_URI, 0, 10);
            expect(items).not.toBeNull();
            expect(items![0].name).toBe('Animal');
        });

        it('returns null when no type is at cursor', () => {
            const emptyTable = setup('// empty file').table;
            const items = prepareTypeHierarchy(emptyTable, TEST_URI, 0, 0);
            expect(items).toBeNull();
        });
    });

    describe('provideSupertypes', () => {
        it('returns superclass for a class extending another class', () => {
            const item = makeItem('Puppy', lsp.SymbolKind.Class, TEST_URI);
            const supertypes = provideSupertypes(table, TEST_URI, item);
            expect(supertypes).toHaveLength(1);
            expect(supertypes[0].name).toBe('Dog');
        });

        it('returns implemented interfaces for a class', () => {
            const item = makeItem('Dog', lsp.SymbolKind.Class, TEST_URI);
            const supertypes = provideSupertypes(table, TEST_URI, item);
            expect(supertypes).toHaveLength(1);
            expect(supertypes[0].name).toBe('Pet');
            expect(supertypes[0].kind).toBe(lsp.SymbolKind.Interface);
        });

        it('returns extended interface for an interface', () => {
            const item = makeItem('Pet', lsp.SymbolKind.Interface, TEST_URI);
            const supertypes = provideSupertypes(table, TEST_URI, item);
            expect(supertypes).toHaveLength(1);
            expect(supertypes[0].name).toBe('Animal');
        });

        it('returns empty array for a type with no supertypes', () => {
            const item = makeItem('Animal', lsp.SymbolKind.Interface, TEST_URI);
            const supertypes = provideSupertypes(table, TEST_URI, item);
            expect(supertypes).toHaveLength(0);
        });

        it('returns empty for an enum with no extends', () => {
            const { table: enumTable } = setup('public enum Color { RED, GREEN, BLUE }');
            const item = makeItem('Color', lsp.SymbolKind.Enum, TEST_URI);
            const supertypes = provideSupertypes(enumTable, TEST_URI, item);
            expect(supertypes).toHaveLength(0);
        });

        it('resolves supertypes from workspace index', () => {
            const wi = new WorkspaceIndex(noopLogger as any);
            const otherUri = 'file:///other/Base.java';
            indexContent(wi, otherUri, 'public class BaseEntity { }');

            const { table: childTable } = setup('public class User extends BaseEntity { }');
            const item = makeItem('User', lsp.SymbolKind.Class, TEST_URI);
            const supertypes = provideSupertypes(childTable, TEST_URI, item, wi);
            expect(supertypes).toHaveLength(1);
            expect(supertypes[0].name).toBe('BaseEntity');
            expect(supertypes[0].uri).toBe(otherUri);
        });
    });

    describe('provideSubtypes', () => {
        it('returns classes extending a given class', () => {
            const item = makeItem('Dog', lsp.SymbolKind.Class, TEST_URI);
            const subtypes = provideSubtypes(table, TEST_URI, item);
            expect(subtypes).toHaveLength(1);
            expect(subtypes[0].name).toBe('Puppy');
        });

        it('returns classes implementing a given interface', () => {
            const item = makeItem('Pet', lsp.SymbolKind.Interface, TEST_URI);
            const subtypes = provideSubtypes(table, TEST_URI, item);
            expect(subtypes).toHaveLength(1);
            expect(subtypes[0].name).toBe('Dog');
        });

        it('returns interfaces extending a given interface', () => {
            const item = makeItem('Animal', lsp.SymbolKind.Interface, TEST_URI);
            const subtypes = provideSubtypes(table, TEST_URI, item);
            expect(subtypes).toHaveLength(1);
            expect(subtypes[0].name).toBe('Pet');
        });

        it('returns empty for a leaf type with no subtypes', () => {
            const item = makeItem('Puppy', lsp.SymbolKind.Class, TEST_URI);
            const subtypes = provideSubtypes(table, TEST_URI, item);
            expect(subtypes).toHaveLength(0);
        });

        it('finds subtypes across workspace index', () => {
            const wi = new WorkspaceIndex(noopLogger as any);
            const otherUri = 'file:///other/Child.java';
            indexContent(wi, otherUri, 'public class GoldenRetriever extends Dog { }');

            const item = makeItem('Dog', lsp.SymbolKind.Class, TEST_URI);
            const subtypes = provideSubtypes(table, TEST_URI, item, wi);
            const names = subtypes.map(s => s.name);
            expect(names).toContain('Puppy');
            expect(names).toContain('GoldenRetriever');
            expect(subtypes).toHaveLength(2);
        });
    });
});
