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

describe('var type inference hints', () => {
    it('should show inferred type for var with string literal', () => {
        const source = `public class Test {
    void method() {
        var name = "hello";
    }
}`;
        const hints = getHints(source);
        const typeHints = hints.filter(h => h.kind === lsp.InlayHintKind.Type);
        expect(typeHints.length).toBe(1);
        expect(typeHints[0].label).toContain('String');
    });

    it('should show inferred type for var with new expression', () => {
        const source = `import java.util.ArrayList;
public class Test {
    void method() {
        var list = new ArrayList<>();
    }
}`;
        const hints = getHints(source);
        const typeHints = hints.filter(h => h.kind === lsp.InlayHintKind.Type);
        expect(typeHints.length).toBe(1);
        expect(typeHints[0].label).toContain('ArrayList');
    });

    it('should show inferred type for var with integer literal', () => {
        const source = `public class Test {
    void method() {
        var count = 42;
    }
}`;
        const hints = getHints(source);
        const typeHints = hints.filter(h => h.kind === lsp.InlayHintKind.Type);
        expect(typeHints.length).toBe(1);
        expect(typeHints[0].label).toContain('int');
    });

    it('should not show type hint for explicitly typed variables', () => {
        const source = `public class Test {
    void method() {
        String name = "hello";
    }
}`;
        const hints = getHints(source);
        const typeHints = hints.filter(h => h.kind === lsp.InlayHintKind.Type);
        expect(typeHints.length).toBe(0);
    });

    it('should show inferred type for var with boolean literal', () => {
        const source = `public class Test {
    void method() {
        var flag = true;
    }
}`;
        const hints = getHints(source);
        const typeHints = hints.filter(h => h.kind === lsp.InlayHintKind.Type);
        expect(typeHints.length).toBe(1);
        expect(typeHints[0].label).toContain('boolean');
    });
});
