/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { CstNode, CstElement, IToken } from 'chevrotain';
import type { SymbolTable, JavaSymbol } from '../java/symbol-table.js';
import { isCstNode } from '../java/cst-utils.js';
import { getTokenAtPosition } from './token-utils.js';

/**
 * Provide call hierarchy for incoming and outgoing calls.
 */

export function prepareCallHierarchy(
    cst: CstNode,
    table: SymbolTable,
    uri: string,
    line: number,
    character: number,
): lsp.CallHierarchyItem[] | null {
    const token = getTokenAtPosition(cst, line, character);
    if (!token) return null;

    const sym = table.allSymbols.find(s =>
        s.name === token.image && (s.kind === 'method' || s.kind === 'constructor'),
    );

    if (!sym) return null;

    return [{
        name: sym.name,
        kind: sym.kind === 'constructor' ? lsp.SymbolKind.Constructor : lsp.SymbolKind.Method,
        uri,
        range: lsp.Range.create(sym.line, sym.column, sym.endLine, sym.endColumn),
        selectionRange: lsp.Range.create(sym.line, sym.column, sym.line, sym.column + sym.name.length),
        detail: sym.parent,
    }];
}

export function provideIncomingCalls(
    cst: CstNode,
    table: SymbolTable,
    uri: string,
    item: lsp.CallHierarchyItem,
): lsp.CallHierarchyIncomingCall[] {
    const callerName = item.name;
    const incoming: lsp.CallHierarchyIncomingCall[] = [];

    // Find all methods that call this method
    for (const sym of table.allSymbols) {
        if (sym.kind !== 'method' && sym.kind !== 'constructor') continue;
        if (sym.name === callerName) continue;

        // Check if this method's body contains a reference to callerName
        // (simplified: check all identifier tokens within the method's range)
        const callSites = findCallSitesInRange(cst, callerName, sym.line, sym.endLine);
        if (callSites.length > 0) {
            incoming.push({
                from: {
                    name: sym.name,
                    kind: sym.kind === 'constructor' ? lsp.SymbolKind.Constructor : lsp.SymbolKind.Method,
                    uri,
                    range: lsp.Range.create(sym.line, sym.column, sym.endLine, sym.endColumn),
                    selectionRange: lsp.Range.create(sym.line, sym.column, sym.line, sym.column + sym.name.length),
                    detail: sym.parent,
                },
                fromRanges: callSites.map(t => lsp.Range.create(
                    (t.startLine ?? 1) - 1,
                    (t.startColumn ?? 1) - 1,
                    (t.endLine ?? 1) - 1,
                    t.endColumn ?? 0,
                )),
            });
        }
    }

    return incoming;
}

export function provideOutgoingCalls(
    cst: CstNode,
    table: SymbolTable,
    uri: string,
    item: lsp.CallHierarchyItem,
): lsp.CallHierarchyOutgoingCall[] {
    const outgoing: lsp.CallHierarchyOutgoingCall[] = [];
    const methodNames = new Set(
        table.allSymbols
            .filter(s => s.kind === 'method' || s.kind === 'constructor')
            .map(s => s.name),
    );

    // Find all method calls within the item's range
    const startLine = item.range.start.line;
    const endLine = item.range.end.line;

    for (const methodName of methodNames) {
        if (methodName === item.name) continue;

        const callSites = findCallSitesInRange(cst, methodName, startLine, endLine);
        if (callSites.length > 0) {
            const sym = table.allSymbols.find(s => s.name === methodName && (s.kind === 'method' || s.kind === 'constructor'));
            if (!sym) continue;

            outgoing.push({
                to: {
                    name: sym.name,
                    kind: sym.kind === 'constructor' ? lsp.SymbolKind.Constructor : lsp.SymbolKind.Method,
                    uri,
                    range: lsp.Range.create(sym.line, sym.column, sym.endLine, sym.endColumn),
                    selectionRange: lsp.Range.create(sym.line, sym.column, sym.line, sym.column + sym.name.length),
                    detail: sym.parent,
                },
                fromRanges: callSites.map(t => lsp.Range.create(
                    (t.startLine ?? 1) - 1,
                    (t.startColumn ?? 1) - 1,
                    (t.endLine ?? 1) - 1,
                    t.endColumn ?? 0,
                )),
            });
        }
    }

    return outgoing;
}

function findCallSitesInRange(cst: CstNode, name: string, startLine: number, endLine: number): IToken[] {
    const tokens: IToken[] = [];
    collectIdentifiersInRange(cst, name, startLine, endLine, tokens);
    return tokens;
}

function collectIdentifiersInRange(
    node: CstNode,
    name: string,
    startLine: number,
    endLine: number,
    tokens: IToken[],
): void {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                collectIdentifiersInRange(child, name, startLine, endLine, tokens);
            } else {
                const token = child as IToken;
                const tokenLine = (token.startLine ?? 1) - 1;
                if (token.image === name &&
                    token.tokenType?.name === 'Identifier' &&
                    tokenLine >= startLine &&
                    tokenLine <= endLine) {
                    tokens.push(token);
                }
            }
        }
    }
}
