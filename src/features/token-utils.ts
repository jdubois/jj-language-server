/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { CstNode, CstElement, IToken } from 'chevrotain';
import { isCstNode } from '../java/cst-utils.js';

/**
 * Find the token at a given 0-based line and character position.
 */
export function getTokenAtPosition(cst: CstNode, line: number, character: number): IToken | undefined {
    const tokens = collectAllTokensSorted(cst);

    // LSP positions are 0-based, Chevrotain tokens are 1-based
    const targetLine = line + 1;
    const targetColumn = character + 1;

    for (const token of tokens) {
        const startLine = token.startLine ?? 1;
        const startCol = token.startColumn ?? 1;
        const endLine = token.endLine ?? startLine;
        const endCol = token.endColumn ?? startCol;

        if (targetLine < startLine || targetLine > endLine) continue;
        if (targetLine === startLine && targetColumn < startCol) continue;
        if (targetLine === endLine && targetColumn > endCol + 1) continue;

        return token;
    }

    return undefined;
}

function collectAllTokensSorted(node: CstNode): IToken[] {
    const tokens: IToken[] = [];
    collectTokensRecursive(node, tokens);
    tokens.sort((a, b) => a.startOffset - b.startOffset);
    return tokens;
}

function collectTokensRecursive(node: CstNode, tokens: IToken[]): void {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                collectTokensRecursive(child, tokens);
            } else {
                tokens.push(child as IToken);
            }
        }
    }
}
