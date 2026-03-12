/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { CstNode } from 'chevrotain';
import type { SymbolTable, JavaSymbol } from '../java/symbol-table.js';

/**
 * Provide advanced refactoring code actions.
 */
export function provideRefactoringActions(
    cst: CstNode,
    table: SymbolTable,
    text: string,
    uri: string,
    range: lsp.Range,
): lsp.CodeAction[] {
    const actions: lsp.CodeAction[] = [];

    // Extract Method — when multiple lines selected
    if (range.start.line !== range.end.line) {
        const action = createExtractMethodAction(text, uri, range, table);
        if (action) actions.push(action);
    }

    // Extract Constant — when single-line expression selected
    if (range.start.line === range.end.line && range.start.character !== range.end.character) {
        const action = createExtractConstantAction(text, uri, range, table);
        if (action) actions.push(action);
    }

    // Inline Variable — when cursor is on a variable declaration
    const inlineAction = createInlineVariableAction(text, uri, range, table);
    if (inlineAction) actions.push(inlineAction);

    return actions;
}

// ---------------------------------------------------------------------------
// Extract Method
// ---------------------------------------------------------------------------

function createExtractMethodAction(
    text: string, uri: string, range: lsp.Range, table: SymbolTable,
): lsp.CodeAction | undefined {
    const lines = text.split('\n');
    const selectedText = getTextInRange(lines, range);
    if (!selectedText.trim()) return undefined;

    const enclosingMethod = findEnclosingMethod(table, range.start.line);
    if (!enclosingMethod) return undefined;

    // Collect parameter candidates: variables and parameters declared before the selection
    // that are referenced inside the selected text.
    const params = detectMethodParameters(enclosingMethod, selectedText, range.start.line);

    const indent = getIndentation(lines, enclosingMethod.line);
    const innerIndent = indent + '    ';

    const paramList = params.map(p => `${p.type} ${p.name}`).join(', ');
    const argList = params.map(p => p.name).join(', ');

    // Re-indent the selected code for the new method body
    const bodyLines = selectedText.split('\n').map(l => innerIndent + l.trimStart()).join('\n');

    const newMethod = `\n${indent}private void extractedMethod(${paramList}) {\n${bodyLines}\n${indent}}\n`;

    // Insert point: after the enclosing method
    const insertLine = enclosingMethod.endLine + 1;

    const callIndent = getIndentation(lines, range.start.line);
    const callText = `${callIndent}extractedMethod(${argList});\n`;

    // Build full-line range covering the selection
    const replaceRange = lsp.Range.create(
        range.start.line, 0,
        range.end.line, lines[range.end.line]?.length ?? 0,
    );

    const edits: lsp.TextEdit[] = [
        lsp.TextEdit.replace(replaceRange, callText),
        lsp.TextEdit.insert(lsp.Position.create(insertLine, 0), newMethod),
    ];

    return {
        title: 'Extract method',
        kind: lsp.CodeActionKind.RefactorExtract,
        edit: { changes: { [uri]: edits } },
    };
}

function detectMethodParameters(
    method: JavaSymbol, selectedText: string, selectionStartLine: number,
): { type: string; name: string }[] {
    const identifiers = extractIdentifiers(selectedText);
    const params: { type: string; name: string }[] = [];
    const seen = new Set<string>();

    // Method parameters are always candidates
    if (method.parameters) {
        for (const p of method.parameters) {
            if (identifiers.has(p.name) && !seen.has(p.name)) {
                params.push({ type: p.type, name: p.name });
                seen.add(p.name);
            }
        }
    }

    // Local variables declared before the selection
    for (const child of method.children) {
        if (child.kind === 'variable' && child.line < selectionStartLine) {
            if (identifiers.has(child.name) && !seen.has(child.name)) {
                params.push({ type: child.type ?? 'var', name: child.name });
                seen.add(child.name);
            }
        }
    }

    return params;
}

function extractIdentifiers(text: string): Set<string> {
    const ids = new Set<string>();
    const regex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
        ids.add(m[1]);
    }
    return ids;
}

// ---------------------------------------------------------------------------
// Extract Constant
// ---------------------------------------------------------------------------

function createExtractConstantAction(
    text: string, uri: string, range: lsp.Range, table: SymbolTable,
): lsp.CodeAction | undefined {
    const lines = text.split('\n');
    const selectedText = lines[range.start.line]?.substring(range.start.character, range.end.character) ?? '';
    if (!selectedText.trim()) return undefined;

    const trimmed = selectedText.trim();
    const type = inferConstantType(trimmed);

    const enclosingClass = findEnclosingClass(table, range.start.line);
    if (!enclosingClass) return undefined;

    const insertLine = findConstantInsertLine(lines, enclosingClass);
    const indent = '    ';
    const declaration = `${indent}private static final ${type} NEW_CONSTANT = ${trimmed};\n`;

    const edits: lsp.TextEdit[] = [
        lsp.TextEdit.insert(lsp.Position.create(insertLine, 0), declaration),
        lsp.TextEdit.replace(range, 'NEW_CONSTANT'),
    ];

    return {
        title: 'Extract to constant',
        kind: lsp.CodeActionKind.RefactorExtract,
        edit: { changes: { [uri]: edits } },
    };
}

function inferConstantType(expr: string): string {
    if (expr.startsWith('"') && expr.endsWith('"')) return 'String';
    if (expr === 'true' || expr === 'false') return 'boolean';
    if (/^-?\d+\.\d+$/.test(expr)) return 'double';
    if (/^-?\d+$/.test(expr)) return 'int';
    return 'var';
}

function findConstantInsertLine(lines: string[], classSym: JavaSymbol): number {
    // Insert after the class opening brace or after the last field declaration
    let insertLine = classSym.line + 1;
    for (const child of classSym.children) {
        if (child.kind === 'field' && child.endLine >= insertLine) {
            insertLine = child.endLine + 1;
        }
    }
    return insertLine;
}

// ---------------------------------------------------------------------------
// Inline Variable
// ---------------------------------------------------------------------------

function createInlineVariableAction(
    text: string, uri: string, range: lsp.Range, table: SymbolTable,
): lsp.CodeAction | undefined {
    const lines = text.split('\n');
    const line = lines[range.start.line];
    if (!line) return undefined;

    const declMatch = line.match(/^\s*([\w<>\[\]]+)\s+(\w+)\s*=\s*(.+?)\s*;\s*$/);
    if (!declMatch) return undefined;

    const varName = declMatch[2];
    const initializer = declMatch[3];

    const enclosingMethod = findEnclosingMethod(table, range.start.line);
    if (!enclosingMethod) return undefined;

    const edits: lsp.TextEdit[] = [];

    // Delete the declaration line (including the newline)
    const deleteTo = range.start.line + 1 < lines.length ? range.start.line + 1 : range.start.line;
    edits.push(lsp.TextEdit.del(lsp.Range.create(
        range.start.line, 0,
        deleteTo, 0,
    )));

    // Replace occurrences of the variable in subsequent lines within the method
    const wordRegex = new RegExp(`\\b${escapeRegex(varName)}\\b`, 'g');
    for (let i = range.start.line + 1; i <= enclosingMethod.endLine && i < lines.length; i++) {
        let match;
        // Reset lastIndex for each line
        wordRegex.lastIndex = 0;
        const replacements: { start: number; end: number }[] = [];
        while ((match = wordRegex.exec(lines[i])) !== null) {
            replacements.push({ start: match.index, end: match.index + varName.length });
        }
        // Apply replacements in reverse order so offsets stay valid
        for (let j = replacements.length - 1; j >= 0; j--) {
            const r = replacements[j];
            edits.push(lsp.TextEdit.replace(
                lsp.Range.create(i, r.start, i, r.end),
                initializer,
            ));
        }
    }

    if (edits.length <= 1) return undefined; // Only the delete, no usages found

    return {
        title: 'Inline variable',
        kind: lsp.CodeActionKind.RefactorInline,
        edit: { changes: { [uri]: edits } },
    };
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTextInRange(lines: string[], range: lsp.Range): string {
    if (range.start.line === range.end.line) {
        return lines[range.start.line]?.substring(range.start.character, range.end.character) ?? '';
    }
    const parts: string[] = [];
    for (let i = range.start.line; i <= range.end.line; i++) {
        const l = lines[i] ?? '';
        if (i === range.start.line) parts.push(l.substring(range.start.character));
        else if (i === range.end.line) parts.push(l.substring(0, range.end.character));
        else parts.push(l);
    }
    return parts.join('\n');
}

function getIndentation(lines: string[], lineNum: number): string {
    const line = lines[lineNum] ?? '';
    const match = line.match(/^(\s*)/);
    return match ? match[1] : '';
}

function findEnclosingMethod(table: SymbolTable, line: number): JavaSymbol | undefined {
    let best: JavaSymbol | undefined;
    for (const sym of table.allSymbols) {
        if (sym.kind !== 'method' && sym.kind !== 'constructor') continue;
        if (line < sym.line || line > sym.endLine) continue;
        if (!best || (sym.endLine - sym.line) < (best.endLine - best.line)) {
            best = sym;
        }
    }
    return best;
}

function findEnclosingClass(table: SymbolTable, line: number): JavaSymbol | undefined {
    let best: JavaSymbol | undefined;
    for (const sym of table.allSymbols) {
        if (!['class', 'record', 'enum'].includes(sym.kind)) continue;
        if (line < sym.line || line > sym.endLine) continue;
        if (!best || (sym.endLine - sym.line) < (best.endLine - best.line)) {
            best = sym;
        }
    }
    return best;
}
