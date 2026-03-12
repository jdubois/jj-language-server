/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { CstNode, CstElement, IToken } from 'chevrotain';
import { isCstNode, getStartPosition, getEndPosition } from '../java/cst-utils.js';

/**
 * Compute folding ranges from a java-parser CST.
 * Supports: class/interface/enum/record bodies, method bodies, blocks,
 * import groups, multi-line comments, and javadoc.
 */
export function computeFoldingRanges(cst: CstNode, text: string): lsp.FoldingRange[] {
    const ranges: lsp.FoldingRange[] = [];

    // Fold import groups
    addImportFoldingRange(cst, ranges);

    // Fold comment blocks from raw text
    addCommentFoldingRanges(text, ranges);

    // Fold all block structures in the CST
    visitForBlocks(cst, ranges);

    return ranges;
}

function addImportFoldingRange(cst: CstNode, ranges: lsp.FoldingRange[]): void {
    const compilationUnit = getChildNode(cst, 'ordinaryCompilationUnit');
    if (!compilationUnit) return;

    const imports = getChildNodes(compilationUnit, 'importDeclaration');
    if (imports.length < 2) return;

    const first = imports[0];
    const last = imports[imports.length - 1];
    const startLine = (getStartPosition(first).line) - 1;
    const endLine = (getEndPosition(last).line) - 1;

    if (endLine > startLine) {
        ranges.push({
            startLine,
            endLine,
            kind: lsp.FoldingRangeKind.Imports,
        });
    }
}

function addCommentFoldingRanges(text: string, ranges: lsp.FoldingRange[]): void {
    // Multi-line comments: /* ... */ and /** ... */
    const commentRegex = /\/\*[\s\S]*?\*\//g;
    let match: RegExpExecArray | null;
    while ((match = commentRegex.exec(text)) !== null) {
        const startLine = lineOfOffset(text, match.index);
        const endLine = lineOfOffset(text, match.index + match[0].length - 1);
        if (endLine > startLine) {
            ranges.push({
                startLine,
                endLine,
                kind: lsp.FoldingRangeKind.Comment,
            });
        }
    }
}

function lineOfOffset(text: string, offset: number): number {
    let line = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') line++;
    }
    return line;
}

/**
 * Recursively walk the CST to find block structures delimited by { }.
 */
function visitForBlocks(node: CstNode, ranges: lsp.FoldingRange[]): void {
    // Look for LCurly/RCurly pairs directly in this node
    const lCurlys = node.children['LCurly'] as IToken[] | undefined;
    const rCurlys = node.children['RCurly'] as IToken[] | undefined;

    if (lCurlys && rCurlys && lCurlys.length > 0 && rCurlys.length > 0) {
        const startLine = (lCurlys[0].startLine ?? 1) - 1;
        const endLine = (rCurlys[rCurlys.length - 1].startLine ?? 1) - 1;
        if (endLine > startLine) {
            ranges.push({ startLine, endLine });
        }
    }

    // Recurse into child nodes
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                visitForBlocks(child, ranges);
            }
        }
    }
}

function getChildNode(node: CstNode, name: string): CstNode | undefined {
    const children = node.children[name] as CstElement[] | undefined;
    if (!children || children.length === 0) return undefined;
    const child = children[0];
    return isCstNode(child) ? child : undefined;
}

function getChildNodes(node: CstNode, name: string): CstNode[] {
    const children = node.children[name] as CstElement[] | undefined;
    if (!children) return [];
    return children.filter(isCstNode);
}
