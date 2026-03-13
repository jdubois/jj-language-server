/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { provideSignatureHelp } from './signature-help.js';
import { buildSymbolTable } from '../java/symbol-table.js';
import { parseJava } from '../java/parser.js';

describe('overload signature help', () => {
    it('should show all overloads for a method', () => {
        const source = `public class Printer {
    void print(String s) {}
    void print(int n) {}
    void print(String s, int n) {}
    void test() {
        print("");
    }
}`;
        // Line 5: `        print("");` — col 14 is inside the parens
        const { cst } = parseJava(source);
        if (!cst) { expect.fail('Failed to parse source'); return; }
        const table = buildSymbolTable(cst);
        const help = provideSignatureHelp(table, source, 5, 14);
        expect(help).toBeTruthy();
        expect(help!.signatures.length).toBeGreaterThanOrEqual(2);
    });

    it('should set active signature based on argument count', () => {
        const source = `public class Printer {
    void print(String s) {}
    void print(String s, int n) {}
    void test() {
        print("hello", 0);
    }
}`;
        // Line 4: `        print("hello", 0);` — col 23 is after the comma, inside 2nd arg
        const { cst } = parseJava(source);
        if (!cst) { expect.fail('Failed to parse source'); return; }
        const table = buildSymbolTable(cst);
        const help = provideSignatureHelp(table, source, 4, 23);
        expect(help).toBeTruthy();
        // The 2-param overload should be preferred
        if (help!.signatures.length >= 2) {
            const activeIdx = help!.activeSignature ?? 0;
            const activeSig = help!.signatures[activeIdx];
            expect(activeSig.parameters?.length).toBe(2);
        }
    });
});
