/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { parse } from 'java-parser';
import type { CstNode, IRecognitionException, IToken } from 'chevrotain';

export interface ParseError {
    message: string;
    token: IToken;
    previousToken?: IToken;
    ruleStack: string[];
}

export interface ParseResult {
    cst: CstNode | undefined;
    errors: ParseError[];
}

export function parseJava(text: string): ParseResult {
    try {
        const cst = parse(text);

        // java-parser throws on errors but may also return partial CST
        // The parse function returns a CstNode directly on success
        return { cst, errors: [] };
    } catch (e: unknown) {
        // java-parser may throw with errors attached
        if (isParseErrorObject(e)) {
            const errors = normalizeErrors(e.errors);
            return { cst: e.cst, errors };
        }

        // Unexpected error
        const message = e instanceof Error ? e.message : String(e);
        return {
            cst: undefined,
            errors: [{
                message: `Parse error: ${message}`,
                token: createFallbackToken(),
                ruleStack: [],
            }],
        };
    }
}

interface ParseErrorObject {
    errors: IRecognitionException[];
    cst?: CstNode;
}

function isParseErrorObject(e: unknown): e is ParseErrorObject {
    return (
        typeof e === 'object' &&
        e !== null &&
        'errors' in e &&
        Array.isArray((e as ParseErrorObject).errors)
    );
}

function normalizeErrors(exceptions: IRecognitionException[]): ParseError[] {
    return exceptions.map(ex => ({
        message: ex.message,
        token: ex.token,
        previousToken: undefined,
        ruleStack: ex.resyncedTokens?.map(t => t.tokenType?.name || '') || [],
    }));
}

function createFallbackToken(): IToken {
    return {
        image: '',
        startOffset: 0,
        startLine: 1,
        startColumn: 1,
        endOffset: 0,
        endLine: 1,
        endColumn: 1,
        tokenTypeIdx: 0,
        tokenType: { name: 'UNKNOWN', tokenTypeIdx: 0, CATEGORIES: [], categoryMatches: [], categoryMatchesMap: {}, isParent: false },
    };
}
