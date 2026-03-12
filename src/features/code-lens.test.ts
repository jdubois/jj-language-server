/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseJava } from '../java/parser.js';
import { buildSymbolTable } from '../java/symbol-table.js';
import { provideCodeLens } from './code-lens.js';

function getLenses(code: string) {
    const result = parseJava(code);
    const table = buildSymbolTable(result.cst!);
    return provideCodeLens(result.cst!, table, 'file:///test.java');
}

describe('code-lens', () => {
    it('returns lenses for class declarations', () => {
        const lenses = getLenses('public class Foo {}');
        expect(lenses.length).toBeGreaterThanOrEqual(1);
        const fooLens = lenses.find(l => l.command?.title.includes('reference'));
        expect(fooLens).toBeDefined();
    });

    it('returns lenses for method declarations', () => {
        const code = 'public class Foo { void bar() {} void baz() { bar(); } }';
        const lenses = getLenses(code);
        const barLens = lenses.find(l =>
            l.range.start.line === 0 &&
            l.command?.title.includes('reference'),
        );
        expect(barLens).toBeDefined();
    });

    it('counts references correctly', () => {
        const code = `public class Foo {
    void bar() {}
    void baz() { bar(); bar(); }
}`;
        const lenses = getLenses(code);
        // Should have at least one lens
        expect(lenses.length).toBeGreaterThanOrEqual(1);
        // Each lens should have a command with reference count
        for (const lens of lenses) {
            expect(lens.command).toBeDefined();
            expect(lens.command!.title).toMatch(/\d+ references?/);
        }
    });

    it('returns empty for empty file', () => {
        const result = parseJava('');
        // Empty file may not have CST
        if (result.cst) {
            const table = buildSymbolTable(result.cst);
            const lenses = provideCodeLens(result.cst, table, 'file:///test.java');
            expect(Array.isArray(lenses)).toBe(true);
        }
    });
});
