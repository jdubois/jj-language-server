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
import { provideLinkedEditingRanges } from './linked-editing.js';

function setup(code: string) {
    const result = parseJava(code);
    if (!result.cst) throw new Error('Parse failed');
    const table = buildSymbolTable(result.cst);
    return { result, table };
}

describe('linked-editing', () => {
    const code = `public class Person {
    private String name;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}`;

    it('should return all occurrences of a variable name', () => {
        const { result, table } = setup(code);
        // "name" on line 1 (field declaration)
        const ranges = provideLinkedEditingRanges(result, table, code, 1, 19);
        expect(ranges).not.toBeNull();
        // "name" appears as field, return stmt, parameter, and usages
        expect(ranges!.ranges.length).toBeGreaterThanOrEqual(4);
        expect(ranges!.wordPattern).toBe('[a-zA-Z_$][a-zA-Z0-9_$]*');
    });

    it('should return all occurrences of a class name', () => {
        const { result, table } = setup(code);
        // "Person" on line 0
        const ranges = provideLinkedEditingRanges(result, table, code, 0, 13);
        expect(ranges).not.toBeNull();
        expect(ranges!.ranges.length).toBeGreaterThanOrEqual(1);
        expect(ranges!.ranges[0].start.line).toBe(0);
    });

    it('should return null when cursor is on whitespace or keyword', () => {
        const { result, table } = setup(code);
        // "public" keyword at line 0, col 0
        const ranges = provideLinkedEditingRanges(result, table, code, 0, 0);
        expect(ranges).toBeNull();
    });

    it('should return occurrences of a method name', () => {
        const { result, table } = setup(code);
        // "getName" on line 3
        const ranges = provideLinkedEditingRanges(result, table, code, 3, 19);
        expect(ranges).not.toBeNull();
        expect(ranges!.ranges.length).toBeGreaterThanOrEqual(1);
    });

    it('should return null for an empty parse result', () => {
        const result = parseJava('');
        const table = result.cst ? buildSymbolTable(result.cst) : { symbols: [], allSymbols: [] };
        const ranges = provideLinkedEditingRanges(result, table, '', 0, 0);
        expect(ranges).toBeNull();
    });
});
