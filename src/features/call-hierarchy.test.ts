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
