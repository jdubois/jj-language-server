/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { provideCompletions } from './completion.js';
import { buildSymbolTable } from '../java/symbol-table.js';
import { parseJava } from '../java/parser.js';
import lsp from 'vscode-languageserver';

function getCompletions(code: string, line: number, character: number) {
    const result = parseJava(code);
    if (!result.cst) return [];
    const table = buildSymbolTable(result.cst);
    return provideCompletions(table, line, character);
}

describe('provideCompletions', () => {
    it('should include class members', () => {
        const code = `public class App {
    private int count;
    public void run() {

    }
}`;
        // Line 3 (inside run method), character 0
        const items = getCompletions(code, 3, 0);
        const names = items.map(i => i.label);
        expect(names).toContain('count');
        expect(names).toContain('run');
        expect(names).toContain('App');
    });

    it('should include Java keywords', () => {
        const code = `public class App {
    public void run() {

    }
}`;
        const items = getCompletions(code, 2, 0);
        const keywords = items.filter(i => i.kind === lsp.CompletionItemKind.Keyword);
        expect(keywords.length).toBeGreaterThan(0);
        const kwNames = keywords.map(k => k.label);
        expect(kwNames).toContain('if');
        expect(kwNames).toContain('for');
        expect(kwNames).toContain('return');
    });

    it('should include snippets', () => {
        const code = `public class App {
    public void run() {

    }
}`;
        const items = getCompletions(code, 2, 0);
        const snippets = items.filter(i => i.kind === lsp.CompletionItemKind.Snippet);
        expect(snippets.length).toBeGreaterThan(0);
        expect(snippets.map(s => s.label)).toContain('sout');
    });

    it('should include constructor parameters', () => {
        const code = `public class App {
    public App(String name, int count) {

    }
}`;
        // Inside constructor body (line 2)
        const items = getCompletions(code, 2, 0);
        const names = items.map(i => i.label);
        expect(names).toContain('name');
        expect(names).toContain('count');
    });
});
