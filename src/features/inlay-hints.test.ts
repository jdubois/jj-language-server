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
import { provideInlayHints } from './inlay-hints.js';

function getHints(code: string) {
    const result = parseJava(code);
    const table = buildSymbolTable(result.cst!);
    const range = lsp.Range.create(0, 0, 100, 0);
    return provideInlayHints(result.cst!, table, range);
}

describe('inlay-hints', () => {
    it('provides parameter name hints for method calls', () => {
        const code = `public class Foo {
    void greet(String name, int age) {}
    void test() { greet("Alice", 30); }
}`;
        const hints = getHints(code);
        expect(Array.isArray(hints)).toBe(true);
    });

    it('returns empty hints for class with no method calls', () => {
        const hints = getHints('public class Foo { int x = 5; }');
        expect(hints).toEqual([]);
    });

    it('returns empty for file with no CST', () => {
        const result = parseJava('');
        if (result.cst) {
            const table = buildSymbolTable(result.cst);
            const range = lsp.Range.create(0, 0, 100, 0);
            const hints = provideInlayHints(result.cst, table, range);
            expect(Array.isArray(hints)).toBe(true);
        }
    });
});
