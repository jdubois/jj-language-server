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
    uri: string,
    range: lsp.Range,
    context: { diagnostics: lsp.Diagnostic[] },
): lsp.CodeAction[] {
    const actions: lsp.CodeAction[] = [];
    const lines = text.split('\n');
    const diagnostics = context.diagnostics;

    // Organize imports action (always available)
    actions.push({
        title: 'Organize Imports',
        kind: lsp.CodeActionKind.SourceOrganizeImports,
        isPreferred: false,
    });

    // Generate actions from selected text/range
    const selectedText = getTextInRange(lines, range);

    // "Extract variable" with real edit
    if (selectedText && selectedText.trim().length > 0 && !selectedText.includes('\n')) {
        const trimmed = selectedText.trim();
        const varName = 'newVariable';
        const indent = getIndentation(lines, range.start.line);
        const declaration = `${indent}var ${varName} = ${trimmed};\n`;
        const edits: lsp.TextEdit[] = [
            // Insert variable declaration before the current line
            lsp.TextEdit.insert(lsp.Position.create(range.start.line, 0), declaration),
            // Replace the selected expression with the variable name
            lsp.TextEdit.replace(range, varName),
        ];
        actions.push({
            title: `Extract to local variable`,
            kind: lsp.CodeActionKind.RefactorExtract,
            edit: { changes: { [uri]: edits } },
        });
    }

    // "Surround with try-catch" with real edit
    if (range.start.line !== range.end.line || selectedText.trim().length > 0) {
        const indent = getIndentation(lines, range.start.line);
        const innerIndent = indent + '    ';
        const selectedLines = getTextInRange(lines, range);
        const reindented = selectedLines.split('\n').map(l => innerIndent + l.trimStart()).join('\n');

        const tryBlock = `${indent}try {\n${reindented}\n${indent}} catch (Exception e) {\n${innerIndent}e.printStackTrace();\n${indent}}`;

        const fullRange = lsp.Range.create(
            range.start.line, 0,
            range.end.line, lines[range.end.line]?.length ?? 0,
        );
        actions.push({
            title: 'Surround with try-catch',
            kind: lsp.CodeActionKind.Refactor,
            edit: { changes: { [uri]: [lsp.TextEdit.replace(fullRange, tryBlock)] } },
        });
    }

    // Add import for unresolved types with real edit
    const unresolvedTypes = findUnresolvedTypeNames(cst, table, text);
    for (const typeName of unresolvedTypes) {
        const jdkType = getJdkType(typeName);
        if (jdkType && jdkType.package !== 'java.lang') {
            const importLine = `import ${jdkType.qualifiedName};\n`;
            const insertLine = findImportInsertLine(lines);
            actions.push({
                title: `Add import '${jdkType.qualifiedName}'`,
                kind: lsp.CodeActionKind.QuickFix,
                isPreferred: true,
                edit: {
                    changes: {
                        [uri]: [lsp.TextEdit.insert(lsp.Position.create(insertLine, 0), importLine)],
                    },
                },
            });
        }
    }

    // Add Move Class action when cursor is on a class declaration
    const classSym = table.allSymbols.find(s =>
        (s.kind === 'class' || s.kind === 'interface' || s.kind === 'enum') &&
        s.line >= range.start.line && s.line <= range.end.line
    );
    if (classSym) {
        actions.push({
            title: `Move '${classSym.name}' to another package`,
            kind: lsp.CodeActionKind.Refactor,
            // This is a "stub" action - the actual move requires user input for the target package
            // LSP clients will show this as an available refactoring
            data: { type: 'moveClass', className: classSym.name, uri },
        });
    }

    // Add Change Signature action when cursor is on a method declaration
    const methodSym = table.allSymbols.find(s =>
        (s.kind === 'method' || s.kind === 'constructor') &&
        s.line >= range.start.line && s.line <= range.end.line
    );
    if (methodSym) {
        actions.push({
            title: `Change signature of '${methodSym.name}'`,
            kind: lsp.CodeActionKind.Refactor,
            data: { type: 'changeSignature', methodName: methodSym.name, uri },
        });
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

function getIndentation(lines: string[], lineNum: number): string {
    const line = lines[lineNum] ?? '';
    const match = line.match(/^(\s*)/);
    return match ? match[1] : '';
}

function findImportInsertLine(lines: string[]): number {
    let lastImportLine = -1;
    let packageLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('package ')) packageLine = i;
        if (trimmed.startsWith('import ')) lastImportLine = i;
    }

    if (lastImportLine >= 0) return lastImportLine + 1;
    if (packageLine >= 0) return packageLine + 2;
    return 0;
}
