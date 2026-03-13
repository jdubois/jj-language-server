/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { CstNode, CstElement, IToken } from 'chevrotain';
import type { SymbolTable } from '../java/symbol-table.js';
import { isCstNode } from '../java/cst-utils.js';

/**
 * Provide code lens (reference counts above declarations).
 */
export function provideCodeLens(
    cst: CstNode,
    table: SymbolTable,
    uri: string,
): lsp.CodeLens[] {
    const lenses: lsp.CodeLens[] = [];

    for (const sym of table.allSymbols) {
        if (!['class', 'interface', 'enum', 'record', 'method'].includes(sym.kind)) continue;

        // Count references in the file
        const refCount = countReferences(cst, sym.name);

        // Don't count the declaration itself
        const adjustedCount = Math.max(0, refCount - 1);

        const range = lsp.Range.create(sym.line, sym.column, sym.line, sym.column + sym.name.length);

        lenses.push({
            range,
            command: {
                title: `${adjustedCount} reference${adjustedCount !== 1 ? 's' : ''}`,
                command: 'editor.action.findReferences',
                arguments: [uri, lsp.Position.create(sym.line, sym.column)],
            },
        });
    }

    return lenses;
}

function countReferences(cst: CstNode, name: string): number {
    countRefsRecursive(cst, name, { count: 0 });
    return countRefsRecursiveResult(cst, name);
}

function countRefsRecursiveResult(node: CstNode, name: string): number {
    let count = 0;
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                count += countRefsRecursiveResult(child, name);
            } else {
                const token = child as IToken;
                if (token.image === name && token.tokenType?.name === 'Identifier') {
                    count++;
                }
            }
        }
    }
    return count;
}

function countRefsRecursive(node: CstNode, name: string, result: { count: number }): void {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                countRefsRecursive(child, name, result);
            } else {
                const token = child as IToken;
                if (token.image === name && token.tokenType?.name === 'Identifier') {
                    result.count++;
                }
            }
        }
    }
}
