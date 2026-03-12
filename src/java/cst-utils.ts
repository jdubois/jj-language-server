/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { CstNode, CstElement, IToken } from 'chevrotain';

/**
 * Check if a CstElement is a CstNode (has children) vs an IToken (leaf).
 */
export function isCstNode(element: CstElement): element is CstNode {
    return 'children' in element && typeof (element as CstNode).children === 'object';
}

/**
 * Get the start position (line, column) of a CST element.
 * Lines and columns are 1-based (as provided by Chevrotain).
 */
export function getStartPosition(element: CstElement): { line: number; column: number } {
    if (isCstNode(element)) {
        const firstToken = findFirstToken(element);
        if (firstToken) {
            return { line: firstToken.startLine ?? 1, column: firstToken.startColumn ?? 1 };
        }
        return { line: 1, column: 1 };
    }
    const token = element as IToken;
    return { line: token.startLine ?? 1, column: token.startColumn ?? 1 };
}

/**
 * Get the end position (line, column) of a CST element.
 */
export function getEndPosition(element: CstElement): { line: number; column: number } {
    if (isCstNode(element)) {
        const lastToken = findLastToken(element);
        if (lastToken) {
            return { line: lastToken.endLine ?? 1, column: (lastToken.endColumn ?? 0) + 1 };
        }
        return { line: 1, column: 1 };
    }
    const token = element as IToken;
    return { line: token.endLine ?? 1, column: (token.endColumn ?? 0) + 1 };
}

/**
 * Recursively find the first token in a CST node.
 */
export function findFirstToken(node: CstNode): IToken | undefined {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children) {
            if (isCstNode(child)) {
                const found = findFirstToken(child);
                if (found) return found;
            } else {
                return child as IToken;
            }
        }
    }
    return undefined;
}

/**
 * Recursively find the last token in a CST node.
 */
export function findLastToken(node: CstNode): IToken | undefined {
    const keys = Object.keys(node.children);
    for (let i = keys.length - 1; i >= 0; i--) {
        const children = node.children[keys[i]];
        if (!children) continue;
        for (let j = children.length - 1; j >= 0; j--) {
            const child = children[j];
            if (isCstNode(child)) {
                const found = findLastToken(child);
                if (found) return found;
            } else {
                return child as IToken;
            }
        }
    }
    return undefined;
}

/**
 * Collect all tokens in a CST node in order of appearance.
 */
export function collectTokens(node: CstNode): IToken[] {
    const tokens: IToken[] = [];
    collectTokensRecursive(node, tokens);
    tokens.sort((a, b) => a.startOffset - b.startOffset);
    return tokens;
}

function collectTokensRecursive(node: CstNode, tokens: IToken[]): void {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children) {
            if (isCstNode(child)) {
                collectTokensRecursive(child, tokens);
            } else {
                tokens.push(child as IToken);
            }
        }
    }
}
