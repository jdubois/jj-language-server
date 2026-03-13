/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { computeSemanticTokens } from './semantic-tokens.js';
import { buildSymbolTable } from '../java/symbol-table.js';
import { parseJava } from '../java/parser.js';

describe('type parameter tokens', () => {
    it('should classify type parameters as typeParameter', () => {
        const source = `public class Box<T> {
    private T value;
    public T getValue() { return value; }
}`;
        const { cst } = parseJava(source);
        const table = buildSymbolTable(cst!);
        const tokens = computeSemanticTokens(cst!, table);
        // The encoded data should contain type 6 (typeParameter) for T usages
        expect(tokens.data.length).toBeGreaterThan(0);
        // Find typeParameter entries (type field is at index 3 of each 5-tuple)
        const typeParamEntries: number[] = [];
        for (let i = 3; i < tokens.data.length; i += 5) {
            if (tokens.data[i] === 6) typeParamEntries.push(i);
        }
        expect(typeParamEntries.length).toBeGreaterThanOrEqual(1);
    });
});
