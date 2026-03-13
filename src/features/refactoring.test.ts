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
import { provideRefactoringActions } from './refactoring.js';
import { createMoveClassAction, createChangeSignatureAction } from './refactoring.js';

function getActions(code: string, startLine: number, startChar: number, endLine: number, endChar: number) {
    const result = parseJava(code);
    const table = buildSymbolTable(result.cst!);
    const range = lsp.Range.create(startLine, startChar, endLine, endChar);
    return provideRefactoringActions(result.cst!, table, code, 'file:///test.java', range);
}

describe('refactoring', () => {
    // -----------------------------------------------------------------------
    // Extract Method
    // -----------------------------------------------------------------------

    it('extract method: multi-line selection creates new method and replaces with call', () => {
        const code = [
            'public class Foo {',
            '    void bar() {',
            '        int x = 1;',
            '        int y = 2;',
            '    }',
            '}',
        ].join('\n');
        // Select lines 2-3 (the two statements)
        const actions = getActions(code, 2, 0, 3, 22);
        const extract = actions.find(a => a.title === 'Extract method');
        expect(extract).toBeDefined();
        expect(extract!.kind).toBe(lsp.CodeActionKind.RefactorExtract);

        const edits = extract!.edit!.changes!['file:///test.java'];
        // Should have a replace (call) and an insert (new method)
        expect(edits.length).toBe(2);
        // The replacement should be a call to extractedMethod
        expect(edits[0].newText).toContain('extractedMethod(');
        // The inserted method should contain the selected code
        expect(edits[1].newText).toContain('private void extractedMethod(');
        expect(edits[1].newText).toContain('int x = 1;');
        expect(edits[1].newText).toContain('int y = 2;');
    });

    it('extract method with parameters: uses variables from outer scope', () => {
        const code = [
            'public class Foo {',
            '    void bar(int a) {',
            '        int b = 10;',
            '        int c = a + b;',
            '        System.out.println(c);',
            '    }',
            '}',
        ].join('\n');
        // Select lines 3-4 (c = a + b  and  println(c))
        const actions = getActions(code, 3, 0, 4, 33);
        const extract = actions.find(a => a.title === 'Extract method');
        expect(extract).toBeDefined();

        const edits = extract!.edit!.changes!['file:///test.java'];
        const methodText = edits[1].newText;
        // Should detect 'a' (parameter) and 'b' (local var before selection) as params
        expect(methodText).toContain('int a');
        // 'b' is declared as `int b = 10` — the symbol table may store the type as 'int'
        expect(methodText).toMatch(/\bb\b/);
        // The call should pass arguments
        expect(edits[0].newText).toContain('extractedMethod(a, b)');
    });

    // -----------------------------------------------------------------------
    // Extract Constant
    // -----------------------------------------------------------------------

    it('extract constant from string literal', () => {
        const code = [
            'public class Foo {',
            '    void bar() {',
            '        String s = "hello";',
            '    }',
            '}',
        ].join('\n');
        // Select "hello" (including quotes) on line 2
        const line2 = '        String s = "hello";';
        const start = line2.indexOf('"hello"');
        const end = start + '"hello"'.length;
        const actions = getActions(code, 2, start, 2, end);
        const extract = actions.find(a => a.title === 'Extract to constant');
        expect(extract).toBeDefined();

        const edits = extract!.edit!.changes!['file:///test.java'];
        // Should insert a constant declaration
        const insertEdit = edits.find(e => e.newText.includes('private static final'));
        expect(insertEdit).toBeDefined();
        expect(insertEdit!.newText).toContain('private static final String NEW_CONSTANT = "hello"');
        // Should replace the selection with the constant name
        const replaceEdit = edits.find(e => e.newText === 'NEW_CONSTANT');
        expect(replaceEdit).toBeDefined();
    });

    it('extract constant from number', () => {
        const code = [
            'public class Foo {',
            '    void bar() {',
            '        int x = 42;',
            '    }',
            '}',
        ].join('\n');
        const line2 = '        int x = 42;';
        const start = line2.indexOf('42');
        const end = start + 2;
        const actions = getActions(code, 2, start, 2, end);
        const extract = actions.find(a => a.title === 'Extract to constant');
        expect(extract).toBeDefined();

        const edits = extract!.edit!.changes!['file:///test.java'];
        const insertEdit = edits.find(e => e.newText.includes('private static final'));
        expect(insertEdit!.newText).toContain('private static final int NEW_CONSTANT = 42');
    });

    it('extract constant from boolean', () => {
        const code = [
            'public class Foo {',
            '    void bar() {',
            '        boolean b = true;',
            '    }',
            '}',
        ].join('\n');
        const line2 = '        boolean b = true;';
        const start = line2.indexOf('true');
        const end = start + 4;
        const actions = getActions(code, 2, start, 2, end);
        const extract = actions.find(a => a.title === 'Extract to constant');
        expect(extract).toBeDefined();

        const edits = extract!.edit!.changes!['file:///test.java'];
        const insertEdit = edits.find(e => e.newText.includes('private static final'));
        expect(insertEdit!.newText).toContain('private static final boolean NEW_CONSTANT = true');
    });

    // -----------------------------------------------------------------------
    // Inline Variable
    // -----------------------------------------------------------------------

    it('inline variable: declaration removed and usage replaced', () => {
        const code = [
            'public class Foo {',
            '    void bar() {',
            '        String name = "hello";',
            '        System.out.println(name);',
            '    }',
            '}',
        ].join('\n');
        // Cursor on the declaration line (line 2)
        const actions = getActions(code, 2, 0, 2, 0);
        const inline = actions.find(a => a.title === 'Inline variable');
        expect(inline).toBeDefined();
        expect(inline!.kind).toBe(lsp.CodeActionKind.RefactorInline);

        const edits = inline!.edit!.changes!['file:///test.java'];
        // Should have a delete for the declaration and a replacement for the usage
        const deleteEdit = edits.find(e => e.newText === '');
        expect(deleteEdit).toBeDefined();
        const replaceEdit = edits.find(e => e.newText === '"hello"');
        expect(replaceEdit).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // Negative cases
    // -----------------------------------------------------------------------

    it('no extract method on single line selection', () => {
        const code = [
            'public class Foo {',
            '    void bar() {',
            '        int x = 1;',
            '    }',
            '}',
        ].join('\n');
        // Single line selection
        const actions = getActions(code, 2, 8, 2, 18);
        const extract = actions.find(a => a.title === 'Extract method');
        expect(extract).toBeUndefined();
    });

    it('no inline variable on non-declaration line', () => {
        const code = [
            'public class Foo {',
            '    void bar() {',
            '        System.out.println("hi");',
            '    }',
            '}',
        ].join('\n');
        // Cursor on method call line
        const actions = getActions(code, 2, 0, 2, 0);
        const inline = actions.find(a => a.title === 'Inline variable');
        expect(inline).toBeUndefined();
    });
});

describe('move class', () => {
    it('should update package declaration', () => {
        const source = `package com.old;

public class MyService {
    public void run() {}
}`;
        const { cst } = parseJava(source);
        const table = buildSymbolTable(cst!);
        const action = createMoveClassAction(
            table, source, 'file:///MyService.java',
            { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
            'com.newpackage'
        );
        expect(action).toBeTruthy();
        const edits = action!.edit!.changes!['file:///MyService.java'];
        expect(edits.length).toBeGreaterThanOrEqual(1);
        expect(edits[0].newText).toBe('package com.newpackage;');
    });

    it('should update imports in other files', () => {
        const source = `package com.old;
public class MyService {}`;
        const otherFile = `package com.other;
import com.old.MyService;
public class Consumer {
    MyService svc;
}`;
        const { cst } = parseJava(source);
        const table = buildSymbolTable(cst!);
        const workspaceFiles = new Map([
            ['file:///Consumer.java', otherFile],
        ]);
        const action = createMoveClassAction(
            table, source, 'file:///MyService.java',
            { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
            'com.newpackage',
            workspaceFiles
        );
        expect(action).toBeTruthy();
        const otherEdits = action!.edit!.changes!['file:///Consumer.java'];
        expect(otherEdits).toBeTruthy();
        expect(otherEdits[0].newText).toBe('import com.newpackage.MyService;');
    });

    it('should return null when cursor is not on a class', () => {
        const source = `package com.old;
public class MyService {
    void method() {}
}`;
        const { cst } = parseJava(source);
        const table = buildSymbolTable(cst!);
        const action = createMoveClassAction(
            table, source, 'file:///test.java',
            { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            'com.new'
        );
        expect(action).toBeNull();
    });
});

describe('change method signature', () => {
    it('should rename parameters', () => {
        const source = `public class Calc {
    int add(int a, int b) { return a + b; }
    void test() {
        add(1, 2);
    }
}`;
        const { cst } = parseJava(source);
        const table = buildSymbolTable(cst!);
        const action = createChangeSignatureAction(
            table, source, 'file:///Calc.java',
            { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
            { newParameters: [{ type: 'int', name: 'x' }, { type: 'int', name: 'y' }] }
        );
        expect(action).toBeTruthy();
        const edits = action!.edit!.changes!['file:///Calc.java'];
        expect(edits.length).toBeGreaterThanOrEqual(1);
        // Method declaration should be updated
        const declEdit = edits.find(e => e.range.start.line === 1);
        expect(declEdit?.newText).toContain('int x');
        expect(declEdit?.newText).toContain('int y');
    });

    it('should add new parameter with placeholder', () => {
        const source = `public class Svc {
    void process(String name) {}
    void test() {
        process("hello");
    }
}`;
        const { cst } = parseJava(source);
        const table = buildSymbolTable(cst!);
        const action = createChangeSignatureAction(
            table, source, 'file:///Svc.java',
            { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
            { newParameters: [{ type: 'String', name: 'name' }, { type: 'int', name: 'count' }] }
        );
        expect(action).toBeTruthy();
        const edits = action!.edit!.changes!['file:///Svc.java'];
        // Call site should be updated with placeholder for new param
        const callEdit = edits.find(e => e.range.start.line === 3);
        expect(callEdit).toBeTruthy();
    });

    it('should return null when cursor is not on a method', () => {
        const source = `public class Foo {
    int field;
}`;
        const { cst } = parseJava(source);
        const table = buildSymbolTable(cst!);
        const action = createChangeSignatureAction(
            table, source, 'file:///Foo.java',
            { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
            { newParameters: [] }
        );
        expect(action).toBeNull();
    });

    it('should change return type', () => {
        const source = `public class Converter {
    int convert(String s) { return 0; }
}`;
        const { cst } = parseJava(source);
        const table = buildSymbolTable(cst!);
        const action = createChangeSignatureAction(
            table, source, 'file:///Converter.java',
            { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
            { newParameters: [{ type: 'String', name: 's' }], newReturnType: 'long' }
        );
        expect(action).toBeTruthy();
        const edits = action!.edit!.changes!['file:///Converter.java'];
        const declEdit = edits.find(e => e.range.start.line === 1);
        expect(declEdit?.newText).toContain('long');
    });
});
