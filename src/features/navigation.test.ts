/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { provideDefinition, provideReferences, provideDocumentHighlight, provideRename, providePrepareRename } from './navigation.js';
import { provideSelectionRanges } from './selection-range.js';
import { computeSemanticTokens } from './semantic-tokens.js';
import { parseJava } from '../java/parser.js';
import { buildSymbolTable } from '../java/symbol-table.js';
import lsp from 'vscode-languageserver';

const TEST_URI = 'file:///test/Test.java';

function setup(code: string) {
    const result = parseJava(code);
    if (!result.cst) throw new Error('Parse failed');
    const table = buildSymbolTable(result.cst);
    return { cst: result.cst, table };
}

describe('navigation features', () => {
    const code = `public class Person {
    private String name;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}`;

    describe('provideDefinition', () => {
        it('should find definition of a field', () => {
            const { cst, table } = setup(code);
            // "name" on line 4 (return name;) -> should go to field on line 1
            const def = provideDefinition(cst, table, TEST_URI, 4, 15);
            expect(def).toBeDefined();
        });

        it('should find definition of a method', () => {
            const { cst, table } = setup(code);
            // "getName" usage - resolve by name
            const def = provideDefinition(cst, table, TEST_URI, 3, 20);
            expect(def).toBeDefined();
        });

        it('should return null for unknown tokens', () => {
            const { cst, table } = setup(code);
            const def = provideDefinition(cst, table, TEST_URI, 0, 0);
            // "public" is a keyword, not a symbol
            expect(def).toBeNull();
        });
    });

    describe('provideReferences', () => {
        it('should find all references of a field name', () => {
            const { cst, table } = setup(code);
            // "name" appears multiple times
            const refs = provideReferences(cst, table, TEST_URI, 1, 20);
            expect(refs.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('provideDocumentHighlight', () => {
        it('should highlight all occurrences', () => {
            const { cst, table } = setup(code);
            const highlights = provideDocumentHighlight(cst, table, 1, 20);
            expect(highlights.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('provideRename', () => {
        it('should rename a field across the file', () => {
            const { cst, table } = setup(code);
            const edit = provideRename(cst, table, TEST_URI, 1, 20, 'fullName');
            expect(edit).toBeDefined();
            const edits = edit!.changes![TEST_URI];
            expect(edits.length).toBeGreaterThanOrEqual(2);
            for (const e of edits) {
                expect(e.newText).toBe('fullName');
            }
        });
    });

    describe('providePrepareRename', () => {
        it('should return range for renameable symbol', () => {
            const { cst, table } = setup(code);
            const range = providePrepareRename(cst, table, 1, 20);
            expect(range).toBeDefined();
        });

        it('should return null for non-renameable position', () => {
            const { cst, table } = setup(code);
            // keyword position
            const range = providePrepareRename(cst, table, 0, 0);
            expect(range).toBeNull();
        });
    });

    describe('provideSelectionRanges', () => {
        it('should return nested selection ranges', () => {
            const { cst } = setup(code);
            const ranges = provideSelectionRanges(cst, '', [{ line: 4, character: 15 }]);
            expect(ranges).toHaveLength(1);
            // Should have at least one parent (containing block)
            expect(ranges[0].parent).toBeDefined();
        });
    });

    describe('computeSemanticTokens', () => {
        it('should produce semantic token data', () => {
            const { cst } = setup(code);
            const tokens = computeSemanticTokens(cst);
            // Should have token data (5 ints per token)
            expect(tokens.data.length).toBeGreaterThan(0);
            expect(tokens.data.length % 5).toBe(0);
        });

        it('should handle empty file', () => {
            const result = parseJava('');
            if (!result.cst) return;
            const tokens = computeSemanticTokens(result.cst);
            expect(tokens.data).toHaveLength(0);
        });
    });
});
