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
import { provideCodeActions } from './code-actions.js';

function getActions(code: string, startLine = 0, startChar = 0, endLine = 0, endChar = 0) {
    const result = parseJava(code);
    const table = buildSymbolTable(result.cst!);
    const range = lsp.Range.create(startLine, startChar, endLine, endChar);
    return provideCodeActions(result.cst!, table, code, range, []);
}

describe('code-actions', () => {
    it('always offers organize imports', () => {
        const actions = getActions('public class Foo {}');
        const organizeAction = actions.find(a => a.title === 'Organize Imports');
        expect(organizeAction).toBeDefined();
        expect(organizeAction!.kind).toBe(lsp.CodeActionKind.SourceOrganizeImports);
    });

    it('offers extract variable for selected expression', () => {
        const code = 'public class Foo { void bar() { int x = 1 + 2; } }';
        const actions = getActions(code, 0, 40, 0, 45); // select "1 + 2"
        const extract = actions.find(a => a.title.includes('Extract'));
        expect(extract).toBeDefined();
        expect(extract!.kind).toBe(lsp.CodeActionKind.RefactorExtract);
    });

    it('offers surround with try-catch for multi-line selection', () => {
        const code = 'public class Foo {\n  void bar() {\n    int x = 1;\n  }\n}';
        const actions = getActions(code, 2, 0, 3, 0);
        const tryCatch = actions.find(a => a.title.includes('try-catch'));
        expect(tryCatch).toBeDefined();
    });

    it('suggests add import for unresolved JDK types', () => {
        const code = 'public class Foo { List<String> items; }';
        const actions = getActions(code, 0, 0, 0, 0);
        const addImport = actions.find(a => a.title.includes('import') && a.title.includes('List'));
        expect(addImport).toBeDefined();
        expect(addImport!.kind).toBe(lsp.CodeActionKind.QuickFix);
    });
});
