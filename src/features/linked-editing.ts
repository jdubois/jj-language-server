/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { LinkedEditingRanges } from 'vscode-languageserver';
import type { SymbolTable } from '../java/symbol-table.js';
import type { ParseResult } from '../java/parser.js';
import type { IToken } from 'chevrotain';
import { getTokenAtPosition } from './token-utils.js';
import { collectTokens } from '../java/cst-utils.js';

/**
 * Provides linked editing ranges for simultaneous identifier renaming.
 * When the cursor is on an identifier, returns all positions of that same
 * identifier in the file so they can be edited simultaneously.
 */
export function provideLinkedEditingRanges(
    parseResult: ParseResult,
    symbolTable: SymbolTable,
    sourceText: string,
    line: number,
    column: number
): LinkedEditingRanges | null {
    if (!parseResult.cst) return null;

    const token = getTokenAtPosition(parseResult.cst, line, column);
    if (!token || token.tokenType?.name !== 'Identifier') return null;

    const name = token.image;
    const allTokens = collectTokens(parseResult.cst);
    const matches = allTokens.filter(
        t => t.image === name && t.tokenType?.name === 'Identifier'
    );

    if (matches.length === 0) return null;

    return {
        ranges: matches.map(t => tokenToRange(t)),
        wordPattern: '[a-zA-Z_$][a-zA-Z0-9_$]*',
    };
}

function tokenToRange(token: IToken) {
    const startLine = (token.startLine ?? 1) - 1;
    const startChar = (token.startColumn ?? 1) - 1;
    const endLine = (token.endLine ?? token.startLine ?? 1) - 1;
    const endChar = (token.endColumn ?? token.startColumn ?? 1);
    return {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
    };
}
