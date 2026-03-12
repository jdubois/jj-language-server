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
 * Provide inlay hints (parameter names, inferred types).
 */
export function provideInlayHints(
    cst: CstNode,
    table: SymbolTable,
    range: lsp.Range,
): lsp.InlayHint[] {
    const hints: lsp.InlayHint[] = [];

    // Find method calls and show parameter names
    collectMethodCallHints(cst, table, range, hints);

    return hints;
}

function collectMethodCallHints(
    node: CstNode,
    table: SymbolTable,
    range: lsp.Range,
    hints: lsp.InlayHint[],
): void {
    // Look for method invocation nodes
    if (node.name === 'methodInvocation' || node.name === 'unqualifiedClassInstanceCreationExpression') {
        addParameterHints(node, table, range, hints);
    }

    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                collectMethodCallHints(child, table, range, hints);
            }
        }
    }
}

function addParameterHints(
    node: CstNode,
    table: SymbolTable,
    range: lsp.Range,
    hints: lsp.InlayHint[],
): void {
    // Find the method name token
    let methodName: string | undefined;
    const identifiers = findChildTokens(node, 'Identifier');
    if (identifiers.length > 0) {
        methodName = identifiers[0].image;
    }

    if (!methodName) return;

    // Find matching method in symbol table
    const method = table.allSymbols.find(s =>
        s.name === methodName && (s.kind === 'method' || s.kind === 'constructor'),
    );

    if (!method?.parameters || method.parameters.length === 0) return;

    // Find argument tokens (tokens inside parentheses that aren't the method name)
    const argTokens = findArgumentPositions(node);
    for (let i = 0; i < Math.min(argTokens.length, method.parameters.length); i++) {
        const argToken = argTokens[i];
        const param = method.parameters[i];
        const line = (argToken.startLine ?? 1) - 1;
        const character = (argToken.startColumn ?? 1) - 1;

        if (line < range.start.line || line > range.end.line) continue;

        hints.push({
            position: lsp.Position.create(line, character),
            label: `${param.name}: `,
            kind: lsp.InlayHintKind.Parameter,
            paddingRight: false,
        });
    }
}

function findChildTokens(node: CstNode, tokenType: string): IToken[] {
    const tokens: IToken[] = [];
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (!isCstNode(child)) {
                const token = child as IToken;
                if (token.tokenType?.name === tokenType) {
                    tokens.push(token);
                }
            }
        }
    }
    return tokens;
}

function findArgumentPositions(node: CstNode): IToken[] {
    const tokens: IToken[] = [];
    // Walk through to find first tokens of each argument expression
    const argList = findChildNode(node, 'argumentList');
    if (!argList) return tokens;

    // Each expression child is an argument
    const expressions = findChildNodes(argList, 'expression');
    for (const expr of expressions) {
        const firstToken = findFirstToken(expr);
        if (firstToken) tokens.push(firstToken);
    }

    return tokens;
}

function findChildNode(node: CstNode, name: string): CstNode | undefined {
    for (const [key, children] of Object.entries(node.children)) {
        if (key === name && children) {
            for (const child of children as CstElement[]) {
                if (isCstNode(child)) return child;
            }
        }
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                const found = findChildNode(child, name);
                if (found) return found;
            }
        }
    }
    return undefined;
}

function findChildNodes(node: CstNode, name: string): CstNode[] {
    const result: CstNode[] = [];
    for (const [key, children] of Object.entries(node.children)) {
        if (!children) continue;
        if (key === name) {
            for (const child of children as CstElement[]) {
                if (isCstNode(child)) result.push(child);
            }
        }
    }
    return result;
}

function findFirstToken(node: CstNode): IToken | undefined {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (!isCstNode(child)) return child as IToken;
            const t = findFirstToken(child);
            if (t) return t;
        }
    }
    return undefined;
}
