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

/**
 * Compute selection ranges (smart expand/shrink) based on CST structure.
 * For each position, returns a nested chain of ranges from most specific
 * to full document.
 */
export function provideSelectionRanges(
    cst: CstNode,
    positions: lsp.Position[],
): lsp.SelectionRange[] {
    return positions.map(pos => computeSelectionRange(cst, pos));
}

function computeSelectionRange(cst: CstNode, position: lsp.Position): lsp.SelectionRange {
    const line = position.line + 1; // CST is 1-based
    const column = position.character + 1;

    // Collect all CST nodes that contain this position, from outermost to innermost
    const containingNodes: CstNode[] = [];
    collectContainingNodes(cst, line, column, containingNodes);

    // Build chain from innermost to outermost
    let current: lsp.SelectionRange | undefined;

    // Start with full document range
    const docRange = nodeToRange(cst);
    current = { range: docRange };

    // Build from outermost to innermost (so innermost has parent = outermost)
    for (const node of containingNodes) {
        const range = nodeToRange(node);
        if (range.start.line !== current.range.start.line ||
            range.start.character !== current.range.start.character ||
            range.end.line !== current.range.end.line ||
            range.end.character !== current.range.end.character) {
            current = { range, parent: current };
        }
    }

    // Add the token range as innermost
    const token = findTokenAtPosition(cst, line, column);
    if (token) {
        const tokenRange = lsp.Range.create(
            (token.startLine ?? 1) - 1,
            (token.startColumn ?? 1) - 1,
            (token.endLine ?? 1) - 1,
            token.endColumn ?? 0,
        );
        current = { range: tokenRange, parent: current };
    }

    return current;
}

function collectContainingNodes(node: CstNode, line: number, column: number, result: CstNode[]): void {
    if (!nodeContainsPosition(node, line, column)) return;

    result.push(node);

    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                collectContainingNodes(child, line, column, result);
            }
        }
    }
}

function nodeContainsPosition(node: CstNode, line: number, column: number): boolean {
    const firstToken = findFirstTokenInNode(node);
    const lastToken = findLastTokenInNode(node);
    if (!firstToken || !lastToken) return false;

    const startLine = firstToken.startLine ?? 1;
    const startCol = firstToken.startColumn ?? 1;
    const endLine = lastToken.endLine ?? 1;
    const endCol = (lastToken.endColumn ?? 0) + 1;

    if (line < startLine || line > endLine) return false;
    if (line === startLine && column < startCol) return false;
    if (line === endLine && column > endCol) return false;
    return true;
}

function nodeToRange(node: CstNode): lsp.Range {
    const firstToken = findFirstTokenInNode(node);
    const lastToken = findLastTokenInNode(node);
    if (!firstToken || !lastToken) {
        return lsp.Range.create(0, 0, 0, 0);
    }
    return lsp.Range.create(
        (firstToken.startLine ?? 1) - 1,
        (firstToken.startColumn ?? 1) - 1,
        (lastToken.endLine ?? firstToken.startLine ?? 1) - 1,
        (lastToken.endColumn ?? 0),
    );
}

function findTokenAtPosition(node: CstNode, line: number, column: number): IToken | undefined {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                const found = findTokenAtPosition(child, line, column);
                if (found) return found;
            } else {
                const token = child as IToken;
                const tl = token.startLine ?? 1;
                const tc = token.startColumn ?? 1;
                const tel = token.endLine ?? tl;
                const tec = (token.endColumn ?? tc) + 1;
                if (line >= tl && line <= tel && column >= tc && column <= tec) {
                    return token;
                }
            }
        }
    }
    return undefined;
}

function findFirstTokenInNode(node: CstNode): IToken | undefined {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                const found = findFirstTokenInNode(child);
                if (found) return found;
            } else {
                return child as IToken;
            }
        }
    }
    return undefined;
}

function findLastTokenInNode(node: CstNode): IToken | undefined {
    const keys = Object.keys(node.children);
    for (let i = keys.length - 1; i >= 0; i--) {
        const children = node.children[keys[i]] as CstElement[] | undefined;
        if (!children) continue;
        for (let j = children.length - 1; j >= 0; j--) {
            if (isCstNode(children[j])) {
                const found = findLastTokenInNode(children[j] as CstNode);
                if (found) return found;
            } else {
                const token = children[j] as IToken;
                // Skip EOF and tokens without valid positions
                if (token.tokenType?.name === 'EOF') continue;
                if (typeof token.endLine !== 'number' || isNaN(token.endLine)) continue;
                return token;
            }
        }
    }
    return undefined;
}
