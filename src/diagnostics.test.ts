/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseErrorsToDiagnostics } from './diagnostics.js';
import type { ParseError } from './java/parser.js';
import type { IToken, TokenType } from 'chevrotain';

function createToken(overrides: Partial<IToken> = {}): IToken {
    return {
        image: 'test',
        startOffset: 0,
        startLine: 1,
        startColumn: 1,
        endOffset: 3,
        endLine: 1,
        endColumn: 4,
        tokenTypeIdx: 0,
        tokenType: { name: 'TEST', tokenTypeIdx: 0, CATEGORIES: [], categoryMatches: [], categoryMatchesMap: {}, isParent: false } as TokenType,
        ...overrides,
    };
}

describe('parseErrorsToDiagnostics', () => {
    it('should return empty array for no errors', () => {
        const result = parseErrorsToDiagnostics([]);
        expect(result).toHaveLength(0);
    });

    it('should convert a single error to a diagnostic', () => {
        const errors: ParseError[] = [{
            message: 'Expecting token of type Semicolon',
            token: createToken({ startLine: 3, startColumn: 10, endLine: 3, endColumn: 12 }),
            ruleStack: [],
        }];

        const diagnostics = parseErrorsToDiagnostics(errors);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].message).toBe('Expecting token of type Semicolon');
        expect(diagnostics[0].severity).toBe(1); // Error
        expect(diagnostics[0].source).toBe('jj-language-server');
        // LSP positions are 0-based, Chevrotain is 1-based
        expect(diagnostics[0].range.start.line).toBe(2);
        expect(diagnostics[0].range.start.character).toBe(9);
        expect(diagnostics[0].range.end.line).toBe(2);
        expect(diagnostics[0].range.end.character).toBe(12);
    });

    it('should convert multiple errors', () => {
        const errors: ParseError[] = [
            {
                message: 'Error 1',
                token: createToken({ startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 }),
                ruleStack: [],
            },
            {
                message: 'Error 2',
                token: createToken({ startLine: 5, startColumn: 3, endLine: 5, endColumn: 8 }),
                ruleStack: [],
            },
        ];

        const diagnostics = parseErrorsToDiagnostics(errors);
        expect(diagnostics).toHaveLength(2);
        expect(diagnostics[0].message).toBe('Error 1');
        expect(diagnostics[1].message).toBe('Error 2');
    });
});
