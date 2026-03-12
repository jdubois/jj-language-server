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
import { getJdkType, getCommonImportableTypes } from '../project/jdk-model.js';
import { isCstNode } from '../java/cst-utils.js';

/**
 * Provide code actions (quick fixes) for diagnostics and context.
 */
export function provideCodeActions(
    cst: CstNode,
    table: SymbolTable,
    text: string,
    range: lsp.Range,
    diagnostics: lsp.Diagnostic[],
): lsp.CodeAction[] {
    const actions: lsp.CodeAction[] = [];
    const lines = text.split('\n');
    const uri = ''; // Will be set by caller

    // Organize imports action (always available)
    actions.push({
        title: 'Organize Imports',
        kind: lsp.CodeActionKind.SourceOrganizeImports,
        isPreferred: false,
    });

    // Generate actions from selected text/range
    const selectedText = getTextInRange(lines, range);

    // "Extract variable" if selecting an expression
    if (selectedText && selectedText.trim().length > 0 && !selectedText.includes('\n')) {
        actions.push({
            title: `Extract to local variable`,
            kind: lsp.CodeActionKind.RefactorExtract,
        });
    }

    // "Surround with try-catch"
    if (range.start.line !== range.end.line || selectedText.trim().length > 0) {
        actions.push({
            title: 'Surround with try-catch',
            kind: lsp.CodeActionKind.Refactor,
        });
    }

    // Add import for unresolved types
    const unresolvedTypes = findUnresolvedTypeNames(cst, table, text);
    for (const typeName of unresolvedTypes) {
        const jdkType = getJdkType(typeName);
        if (jdkType && jdkType.package !== 'java.lang') {
            actions.push({
                title: `Add import '${jdkType.qualifiedName}'`,
                kind: lsp.CodeActionKind.QuickFix,
            });
        }
    }

    return actions;
}

function getTextInRange(lines: string[], range: lsp.Range): string {
    if (range.start.line === range.end.line) {
        return lines[range.start.line]?.substring(range.start.character, range.end.character) ?? '';
    }
    const parts: string[] = [];
    for (let i = range.start.line; i <= range.end.line; i++) {
        const line = lines[i] ?? '';
        if (i === range.start.line) parts.push(line.substring(range.start.character));
        else if (i === range.end.line) parts.push(line.substring(0, range.end.character));
        else parts.push(line);
    }
    return parts.join('\n');
}

function findUnresolvedTypeNames(cst: CstNode, table: SymbolTable, text: string): string[] {
    const importableTypes = new Set(getCommonImportableTypes().map(t => t.name));
    const declaredTypes = new Set(table.symbols.map(s => s.name));
    const importedTypes = extractImportedNames(text);
    const used = new Set<string>();

    // Find all identifiers that could be type references
    collectPotentialTypeRefs(cst, used);

    const unresolved: string[] = [];
    for (const name of used) {
        if (importableTypes.has(name) && !declaredTypes.has(name) && !importedTypes.has(name)) {
            const jdkType = getJdkType(name);
            if (jdkType && jdkType.package !== 'java.lang') {
                unresolved.push(name);
            }
        }
    }
    return unresolved;
}

function extractImportedNames(text: string): Set<string> {
    const names = new Set<string>();
    const regex = /import\s+(static\s+)?([a-zA-Z0-9_.]+)\s*;/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const parts = match[2].split('.');
        names.add(parts[parts.length - 1]);
    }
    return names;
}

function collectPotentialTypeRefs(node: CstNode, refs: Set<string>): void {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                collectPotentialTypeRefs(child, refs);
            } else {
                const token = child as IToken;
                if (token.tokenType?.name === 'Identifier' && /^[A-Z]/.test(token.image)) {
                    refs.add(token.image);
                }
            }
        }
    }
}
