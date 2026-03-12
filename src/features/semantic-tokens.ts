/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { CstNode, CstElement, IToken } from 'chevrotain';
import { isCstNode } from '../java/cst-utils.js';

// Semantic token types - must match the legend sent to the client
export const SEMANTIC_TOKEN_TYPES = [
    'namespace',     // 0 - package
    'type',          // 1 - class/interface/enum/record
    'class',         // 2
    'enum',          // 3
    'interface',     // 4
    'struct',        // 5 - record
    'typeParameter', // 6
    'parameter',     // 7
    'variable',      // 8
    'property',      // 9 - field
    'enumMember',    // 10
    'function',      // 11 - method
    'method',        // 12
    'keyword',       // 13
    'modifier',      // 14
    'comment',       // 15
    'string',        // 16
    'number',        // 17
    'operator',      // 18
    'decorator',     // 19 - annotation
] as const;

export const SEMANTIC_TOKEN_MODIFIERS = [
    'declaration',   // 0
    'definition',    // 1
    'readonly',      // 2
    'static',        // 3
    'deprecated',    // 4
    'abstract',      // 5
    'async',         // 6
    'modification',  // 7
    'documentation', // 8
    'defaultLibrary',// 9
] as const;

export function getSemanticTokensLegend(): lsp.SemanticTokensLegend {
    return {
        tokenTypes: [...SEMANTIC_TOKEN_TYPES],
        tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
    };
}

/**
 * Compute semantic tokens for a parsed Java file.
 */
export function computeSemanticTokens(cst: CstNode): lsp.SemanticTokens {
    const tokens: IToken[] = [];
    collectAllTokens(cst, tokens);
    tokens.sort((a, b) => a.startOffset - b.startOffset);

    const data: number[] = [];
    let prevLine = 0;
    let prevChar = 0;

    for (const token of tokens) {
        const tokenType = classifyToken(token);
        if (tokenType < 0) continue;

        const line = (token.startLine ?? 1) - 1;
        const char = (token.startColumn ?? 1) - 1;
        const length = token.image.length;

        const deltaLine = line - prevLine;
        const deltaChar = deltaLine === 0 ? char - prevChar : char;

        data.push(deltaLine, deltaChar, length, tokenType, 0);

        prevLine = line;
        prevChar = char;
    }

    return { data };
}

function classifyToken(token: IToken): number {
    const name = token.tokenType?.name;
    if (!name) return -1;

    // Keywords
    const javaKeywords = new Set([
        'Abstract', 'Assert', 'Boolean', 'Break', 'Byte', 'Case', 'Catch',
        'Char', 'Class', 'Continue', 'Default', 'Do', 'Double', 'Else',
        'Enum', 'Extends', 'Final', 'Finally', 'Float', 'For', 'If',
        'Implements', 'Import', 'Instanceof', 'Int', 'Interface', 'Long',
        'Native', 'New', 'Package', 'Private', 'Protected', 'Public',
        'Return', 'Short', 'Static', 'Strictfp', 'Super', 'Switch',
        'Synchronized', 'This', 'Throw', 'Throws', 'Transient', 'Try',
        'Void', 'Volatile', 'While', 'Yield', 'Var', 'Record', 'Sealed',
        'Permits', 'NonSealed',
    ]);

    if (javaKeywords.has(name)) return 13; // keyword

    // Modifiers (access modifiers are also keywords)
    if (name === 'Public' || name === 'Private' || name === 'Protected' ||
        name === 'Static' || name === 'Final' || name === 'Abstract') {
        return 14; // modifier
    }

    // Literals
    if (name === 'StringLiteral' || name === 'TextBlock' || name === 'CharLiteral') return 16;
    if (name.includes('Literal') && (name.includes('Int') || name.includes('Float') ||
        name.includes('Long') || name.includes('Double') || name.includes('Decimal') ||
        name.includes('Hex') || name.includes('Octal') || name.includes('Binary'))) return 17;

    // Operators
    if (['Plus', 'Minus', 'Star', 'Slash', 'Percent', 'And', 'Or', 'Equals',
         'Less', 'Greater', 'Not', 'Tilde', 'QuestionMark', 'Colon',
         'Arrow', 'ColonColon'].includes(name)) return 18;

    // Annotations
    if (name === 'At') return 19;

    return -1; // Skip unknown tokens (Identifiers need context to classify)
}

function collectAllTokens(node: CstNode, tokens: IToken[]): void {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                collectAllTokens(child, tokens);
            } else {
                tokens.push(child as IToken);
            }
        }
    }
}
