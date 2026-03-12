/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { CstNode } from 'chevrotain';
import type { SymbolTable } from '../java/symbol-table.js';
import { resolveSymbolByName, findSymbolsByName } from '../java/scope-resolver.js';
import { getTokenAtPosition } from './token-utils.js';

/**
 * Go to definition: find the declaration of the symbol under the cursor.
 */
export function provideDefinition(
    cst: CstNode,
    table: SymbolTable,
    uri: string,
    line: number,
    character: number,
): lsp.Location | null {
    const token = getTokenAtPosition(cst, line, character);
    if (!token) return null;

    const sym = resolveSymbolByName(table, token.image, line, character);
    if (!sym) return null;

    return lsp.Location.create(
        uri,
        lsp.Range.create(sym.line, sym.column, sym.endLine, sym.endColumn),
    );
}

/**
 * Find all references to the symbol under the cursor within the file.
 * If searchName is provided, find all references to that name (used for cross-file search).
 */
export function provideReferences(
    cst: CstNode,
    table: SymbolTable,
    uri: string,
    line: number,
    character: number,
    searchName?: string,
): lsp.Location[] {
    let name: string;
    if (searchName) {
        name = searchName;
    } else {
        const token = getTokenAtPosition(cst, line, character);
        if (!token) return [];
        name = token.image;
    }

    const locations: lsp.Location[] = [];

    // Find all tokens with this name in the file
    const allTokens = collectAllIdentifierTokens(cst, name);
    for (const t of allTokens) {
        locations.push(lsp.Location.create(
            uri,
            lsp.Range.create(
                (t.startLine ?? 1) - 1,
                (t.startColumn ?? 1) - 1,
                (t.endLine ?? 1) - 1,
                t.endColumn ?? 0,
            ),
        ));
    }

    return locations;
}

/**
 * Highlight all occurrences of the symbol under the cursor.
 */
export function provideDocumentHighlight(
    cst: CstNode,
    table: SymbolTable,
    line: number,
    character: number,
): lsp.DocumentHighlight[] {
    const token = getTokenAtPosition(cst, line, character);
    if (!token) return [];

    const name = token.image;
    const highlights: lsp.DocumentHighlight[] = [];

    // Also check if this name resolves to a known symbol
    const sym = resolveSymbolByName(table, name, line, character);

    const allTokens = collectAllIdentifierTokens(cst, name);
    for (const t of allTokens) {
        const range = lsp.Range.create(
            (t.startLine ?? 1) - 1,
            (t.startColumn ?? 1) - 1,
            (t.endLine ?? 1) - 1,
            t.endColumn ?? 0,
        );

        // If the token is at the definition position, mark as Write
        const kind = sym && t.startLine === sym.line + 1 && t.startColumn === sym.column + 1
            ? lsp.DocumentHighlightKind.Write
            : lsp.DocumentHighlightKind.Read;

        highlights.push({ range, kind });
    }

    return highlights;
}

/**
 * Rename the symbol under the cursor across the file.
 */
export function provideRename(
    cst: CstNode,
    table: SymbolTable,
    uri: string,
    line: number,
    character: number,
    newName: string,
): lsp.WorkspaceEdit | null {
    const token = getTokenAtPosition(cst, line, character);
    if (!token) return null;

    const name = token.image;

    // Verify this is a renameable symbol
    const sym = resolveSymbolByName(table, name, line, character);
    if (!sym) return null;

    const allTokens = collectAllIdentifierTokens(cst, name);
    const edits: lsp.TextEdit[] = allTokens.map(t => lsp.TextEdit.replace(
        lsp.Range.create(
            (t.startLine ?? 1) - 1,
            (t.startColumn ?? 1) - 1,
            (t.endLine ?? 1) - 1,
            t.endColumn ?? 0,
        ),
        newName,
    ));

    return { changes: { [uri]: edits } };
}

/**
 * Prepare rename: return the range of the symbol that would be renamed.
 */
export function providePrepareRename(
    cst: CstNode,
    table: SymbolTable,
    line: number,
    character: number,
): lsp.Range | null {
    const token = getTokenAtPosition(cst, line, character);
    if (!token) return null;

    // Only allow renaming known symbols
    const sym = resolveSymbolByName(table, token.image, line, character);
    if (!sym) return null;

    return lsp.Range.create(
        (token.startLine ?? 1) - 1,
        (token.startColumn ?? 1) - 1,
        (token.endLine ?? 1) - 1,
        token.endColumn ?? 0,
    );
}

// --- Helpers ---

import type { CstElement, IToken } from 'chevrotain';
import { isCstNode } from '../java/cst-utils.js';

function collectAllIdentifierTokens(node: CstNode, name: string): IToken[] {
    const tokens: IToken[] = [];
    collectIdentifiersRecursive(node, name, tokens);
    tokens.sort((a, b) => a.startOffset - b.startOffset);
    return tokens;
}

function collectIdentifiersRecursive(node: CstNode, name: string, tokens: IToken[]): void {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                collectIdentifiersRecursive(child, name, tokens);
            } else {
                const token = child as IToken;
                if (token.image === name && token.tokenType?.name === 'Identifier') {
                    tokens.push(token);
                }
            }
        }
    }
}
