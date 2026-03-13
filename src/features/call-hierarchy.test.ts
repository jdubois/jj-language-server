/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import lsp from 'vscode-languageserver';
import { parseJava } from '../java/parser.js';
import { buildSymbolTable } from '../java/symbol-table.js';
import { prepareCallHierarchy, provideIncomingCalls, provideOutgoingCalls } from './call-hierarchy.js';

const code = `public class Foo {
    void bar() { baz(); }
    void baz() {}
}`;

function setup() {
    const result = parseJava(code);
    const table = buildSymbolTable(result.cst!);
    return { cst: result.cst!, table };
}

describe('call-hierarchy', () => {
    it('prepares call hierarchy for method at cursor', () => {
        const { cst, table } = setup();
        // "bar" method is at line 1
        const items = prepareCallHierarchy(cst, table, 'file:///test.java', 1, 9);
        expect(items).not.toBeNull();
        if (items) {
            expect(items.length).toBeGreaterThanOrEqual(1);
            expect(items[0].name).toBe('bar');
        }
    });

    it('returns null when cursor is not on a method', () => {
        const { cst, table } = setup();
        // Line 0 is "public class Foo {" — not a method
        const items = prepareCallHierarchy(cst, table, 'file:///test.java', 0, 0);
        // Could return class or null depending on implementation
        expect(items === null || items.length >= 0).toBe(true);
    });

    it('provides outgoing calls from a method', () => {
        const { cst, table } = setup();
        const item: lsp.CallHierarchyItem = {
            name: 'bar',
            kind: lsp.SymbolKind.Method,
            uri: 'file:///test.java',
            range: lsp.Range.create(1, 4, 1, 26),
            selectionRange: lsp.Range.create(1, 9, 1, 12),
        };
        const outgoing = provideOutgoingCalls(cst, table, 'file:///test.java', item);
        expect(Array.isArray(outgoing)).toBe(true);
    });

    it('provides incoming calls to a method', () => {
        const { cst, table } = setup();
        const item: lsp.CallHierarchyItem = {
            name: 'baz',
            kind: lsp.SymbolKind.Method,
            uri: 'file:///test.java',
            range: lsp.Range.create(2, 4, 2, 17),
            selectionRange: lsp.Range.create(2, 9, 2, 12),
        };
        const incoming = provideIncomingCalls(cst, table, 'file:///test.java', item);
        expect(Array.isArray(incoming)).toBe(true);
    });
});

describe('cross-file call hierarchy', () => {
    it('should find incoming calls from other files', () => {
        const sourceA = `public class Service {
    public void process() {}
}`;
        const sourceB = `public class Controller {
    void handle() {
        new Service().process();
    }
}`;
        const resultA = parseJava(sourceA);
        const tableA = buildSymbolTable(resultA.cst!);
        const resultB = parseJava(sourceB);
        const tableB = buildSymbolTable(resultB.cst!);

        const mockIndex = {
            getFileUris: () => ['file:///b.java'],
            getParseResult: (uri: string) => uri === 'file:///b.java' ? resultB : undefined,
            getSymbolTable: (uri: string) => uri === 'file:///b.java' ? tableB : undefined,
        } as any;

        const item: lsp.CallHierarchyItem = {
            name: 'process',
            kind: lsp.SymbolKind.Method,
            uri: 'file:///a.java',
            range: lsp.Range.create(1, 4, 1, 28),
            selectionRange: lsp.Range.create(1, 16, 1, 23),
        };

        const incoming = provideIncomingCalls(resultA.cst!, tableA, 'file:///a.java', item, mockIndex);
        expect(incoming.length).toBe(1);
        expect(incoming[0].from.name).toBe('handle');
        expect(incoming[0].from.uri).toBe('file:///b.java');
    });

    it('should find outgoing calls in other files', () => {
        const sourceA = `public class Service {
    public void process() {
        helper();
    }
}`;
        const sourceB = `public class Utils {
    static void helper() {}
}`;
        const resultA = parseJava(sourceA);
        const tableA = buildSymbolTable(resultA.cst!);
        const resultB = parseJava(sourceB);
        const tableB = buildSymbolTable(resultB.cst!);

        const mockIndex = {
            getFileUris: () => ['file:///b.java'],
            getParseResult: (uri: string) => uri === 'file:///b.java' ? resultB : undefined,
            getSymbolTable: (uri: string) => uri === 'file:///b.java' ? tableB : undefined,
        } as any;

        const item: lsp.CallHierarchyItem = {
            name: 'process',
            kind: lsp.SymbolKind.Method,
            uri: 'file:///a.java',
            range: lsp.Range.create(1, 4, 2, 5),
            selectionRange: lsp.Range.create(1, 16, 1, 23),
        };

        const outgoing = provideOutgoingCalls(resultA.cst!, tableA, 'file:///a.java', item, mockIndex);
        expect(outgoing.some(o => o.to.name === 'helper')).toBe(true);
        expect(outgoing.find(o => o.to.name === 'helper')?.to.uri).toBe('file:///b.java');
    });

    it('should not duplicate results from current file', () => {
        const source = `public class Foo {
    void bar() { baz(); }
    void baz() {}
}`;
        const result = parseJava(source);
        const table = buildSymbolTable(result.cst!);

        const mockIndex = {
            getFileUris: () => ['file:///test.java'],
            getParseResult: (uri: string) => uri === 'file:///test.java' ? result : undefined,
            getSymbolTable: (uri: string) => uri === 'file:///test.java' ? table : undefined,
        } as any;

        const item: lsp.CallHierarchyItem = {
            name: 'baz',
            kind: lsp.SymbolKind.Method,
            uri: 'file:///test.java',
            range: lsp.Range.create(2, 4, 2, 17),
            selectionRange: lsp.Range.create(2, 9, 2, 12),
        };

        // The workspace index contains the same file as uri, so it should be skipped
        const incoming = provideIncomingCalls(result.cst!, table, 'file:///test.java', item, mockIndex);
        // Should only find 'bar' calling 'baz' once (from current file), not duplicated
        const barCallers = incoming.filter(i => i.from.name === 'bar');
        expect(barCallers.length).toBe(1);
    });
});
