/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceIndex } from './project/workspace-index.js';
import { parseJava } from './java/parser.js';
import { buildSymbolTable } from './java/symbol-table.js';

const noopLogger = {
    info: () => {},
    warn: () => {},
    log: () => {},
    error: () => {},
};

function indexContent(wi: WorkspaceIndex, uri: string, code: string): void {
    const result = parseJava(code);
    if (result.cst) {
        const table = buildSymbolTable(result.cst);
        wi.updateFile(uri, result, table);
    }
}

describe('WorkspaceIndex', () => {
    let wi: WorkspaceIndex;

    beforeEach(() => {
        wi = new WorkspaceIndex(noopLogger as any);
    });

    it('indexes a single file and searches symbols', () => {
        indexContent(wi, 'file:///src/Foo.java', `
            public class Foo {
                public void bar() {}
                private int baz;
            }
        `);

        const all = wi.searchSymbols('');
        expect(all.length).toBeGreaterThanOrEqual(3);

        const fooResults = wi.searchSymbols('Foo');
        expect(fooResults.some(s => s.name === 'Foo' && s.kind === 'class')).toBe(true);

        const barResults = wi.searchSymbols('bar');
        expect(barResults.some(s => s.name === 'bar' && s.kind === 'method')).toBe(true);
    });

    it('searches across multiple files', () => {
        indexContent(wi, 'file:///src/A.java', `
            public class A {
                public void methodA() {}
            }
        `);
        indexContent(wi, 'file:///src/B.java', `
            public class B {
                public void methodB() {}
            }
        `);

        const all = wi.searchSymbols('');
        expect(all.length).toBeGreaterThanOrEqual(4);

        expect(wi.searchSymbols('A').some(s => s.name === 'A' && s.uri === 'file:///src/A.java')).toBe(true);
        expect(wi.searchSymbols('B').some(s => s.name === 'B' && s.uri === 'file:///src/B.java')).toBe(true);
    });

    it('findTypeByName returns class declarations', () => {
        indexContent(wi, 'file:///src/MyClass.java', `
            public class MyClass {
                public void doSomething() {}
            }
        `);

        const result = wi.findTypeByName('MyClass');
        expect(result).toBeDefined();
        expect(result!.name).toBe('MyClass');
        expect(result!.kind).toBe('class');
        expect(result!.uri).toBe('file:///src/MyClass.java');
    });

    it('findTypeByName returns undefined for non-existent types', () => {
        indexContent(wi, 'file:///src/Foo.java', `public class Foo {}`);
        expect(wi.findTypeByName('NonExistent')).toBeUndefined();
    });

    it('findTypeByName finds enums and interfaces', () => {
        indexContent(wi, 'file:///src/MyEnum.java', `
            public enum Color { RED, GREEN, BLUE }
        `);
        indexContent(wi, 'file:///src/MyIface.java', `
            public interface Runnable { void run(); }
        `);

        expect(wi.findTypeByName('Color')?.kind).toBe('enum');
        expect(wi.findTypeByName('Runnable')?.kind).toBe('interface');
    });

    it('findDeclarationsByName returns all matching symbols', () => {
        indexContent(wi, 'file:///src/A.java', `
            public class A {
                public void process() {}
            }
        `);
        indexContent(wi, 'file:///src/B.java', `
            public class B {
                public void process() {}
            }
        `);

        const decls = wi.findDeclarationsByName('process');
        expect(decls.length).toBe(2);
        expect(decls.map(d => d.uri)).toContain('file:///src/A.java');
        expect(decls.map(d => d.uri)).toContain('file:///src/B.java');
    });

    it('removeFile removes the file from the index', () => {
        indexContent(wi, 'file:///src/Foo.java', `public class Foo {}`);
        expect(wi.searchSymbols('Foo').length).toBeGreaterThan(0);

        wi.removeFile('file:///src/Foo.java');
        expect(wi.searchSymbols('Foo').length).toBe(0);
    });

    it('updateFile replaces previous index for the same URI', () => {
        indexContent(wi, 'file:///src/Foo.java', `
            public class Foo {
                public void oldMethod() {}
            }
        `);
        expect(wi.searchSymbols('oldMethod').length).toBeGreaterThan(0);

        indexContent(wi, 'file:///src/Foo.java', `
            public class Foo {
                public void newMethod() {}
            }
        `);
        expect(wi.searchSymbols('oldMethod').length).toBe(0);
        expect(wi.searchSymbols('newMethod').length).toBeGreaterThan(0);
    });

    it('getFileUris returns all indexed files', () => {
        indexContent(wi, 'file:///src/A.java', `public class A {}`);
        indexContent(wi, 'file:///src/B.java', `public class B {}`);

        const uris = wi.getFileUris();
        expect(uris).toContain('file:///src/A.java');
        expect(uris).toContain('file:///src/B.java');
        expect(uris.length).toBe(2);
    });

    it('search is case-insensitive', () => {
        indexContent(wi, 'file:///src/Foo.java', `public class MySpecialClass {}`);

        expect(wi.searchSymbols('myspecial').length).toBeGreaterThan(0);
        expect(wi.searchSymbols('MYSPECIAL').length).toBeGreaterThan(0);
    });

    it('search results are limited to 100', () => {
        const methods = Array.from({ length: 150 }, (_, i) => `public void m${i}() {}`).join('\n    ');
        indexContent(wi, 'file:///src/Big.java', `
            public class Big {
                ${methods}
            }
        `);

        const results = wi.searchSymbols('m');
        expect(results.length).toBeLessThanOrEqual(100);
    });

    it('getSymbolTable and getParseResult return correct data', () => {
        indexContent(wi, 'file:///src/Foo.java', `public class Foo { int x; }`);

        const table = wi.getSymbolTable('file:///src/Foo.java');
        expect(table).toBeDefined();
        expect(table!.allSymbols.length).toBeGreaterThan(0);

        const result = wi.getParseResult('file:///src/Foo.java');
        expect(result).toBeDefined();
        expect(result!.cst).toBeDefined();
    });

    it('findTypeByName finds record types', () => {
        indexContent(wi, 'file:///src/Point.java', `
            public record Point(int x, int y) {}
        `);

        const result = wi.findTypeByName('Point');
        expect(result).toBeDefined();
        expect(result!.name).toBe('Point');
        expect(result!.kind).toBe('record');
    });

    it('indexes records in global symbols', () => {
        indexContent(wi, 'file:///src/Pair.java', `
            public record Pair(String a, String b) {}
        `);

        const results = wi.searchSymbols('Pair');
        expect(results.some(s => s.name === 'Pair' && s.kind === 'record')).toBe(true);
    });
});
