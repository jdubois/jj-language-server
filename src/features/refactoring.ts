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

export interface SignatureChange {
    /** New method name (or same if unchanged) */
    newName?: string;
    /** New parameter list. Use existing param names to keep, omit to remove, add new ones */
    newParameters: { type: string; name: string }[];
    /** New return type (or undefined to keep) */
    newReturnType?: string;
}

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
// Move Class
// ---------------------------------------------------------------------------

/**
 * Create a "Move Class" refactoring action.
 * When triggered on a class declaration, generates edits to:
 * 1. Update the package declaration in the source file
 * 2. Update all import statements across workspace files that reference this class
 */
export function createMoveClassAction(
    table: SymbolTable,
    text: string,
    uri: string,
    range: lsp.Range,
    newPackage: string,
    workspaceFiles?: Map<string, string>,  // uri → text content
): lsp.CodeAction | null {
    // Find class at cursor
    const classSym = table.allSymbols.find(s =>
        (s.kind === 'class' || s.kind === 'interface' || s.kind === 'enum' || s.kind === 'record') &&
        s.line >= range.start.line && s.line <= range.end.line
    );
    if (!classSym) return null;

    const changes: { [uri: string]: lsp.TextEdit[] } = {};
    const edits: lsp.TextEdit[] = [];

    // 1. Update package declaration in current file
    const lines = text.split('\n');
    const packageLine = lines.findIndex(l => l.trimStart().startsWith('package '));
    if (packageLine >= 0) {
        // Replace existing package
        const lineText = lines[packageLine];
        edits.push(lsp.TextEdit.replace(
            lsp.Range.create(packageLine, 0, packageLine, lineText.length),
            `package ${newPackage};`
        ));
    } else {
        // Insert package at top (after any comments)
        let insertLine = 0;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed === '') {
                insertLine = i + 1;
            } else break;
        }
        edits.push(lsp.TextEdit.insert(
            lsp.Position.create(insertLine, 0),
            `package ${newPackage};\n\n`
        ));
    }

    changes[uri] = edits;

    // 2. Find old package name from the current file
    const oldPackageLine = lines.find(l => l.trimStart().startsWith('package '));
    const oldPackage = oldPackageLine
        ? oldPackageLine.trim().replace(/^package\s+/, '').replace(/;.*$/, '').trim()
        : '';
    const oldQualified = oldPackage ? `${oldPackage}.${classSym.name}` : classSym.name;
    const newQualified = `${newPackage}.${classSym.name}`;

    // 3. Update imports in other workspace files
    if (workspaceFiles) {
        for (const [fileUri, fileText] of workspaceFiles.entries()) {
            if (fileUri === uri) continue;
            const fileLines = fileText.split('\n');
            const fileEdits: lsp.TextEdit[] = [];

            for (let i = 0; i < fileLines.length; i++) {
                const line = fileLines[i];
                // Match import of old qualified name
                if (line.trim() === `import ${oldQualified};`) {
                    fileEdits.push(lsp.TextEdit.replace(
                        lsp.Range.create(i, 0, i, line.length),
                        `import ${newQualified};`
                    ));
                }
                // Match wildcard import of old package
                if (line.trim() === `import ${oldPackage}.*;`) {
                    // Wildcard still works, but add explicit import for the moved class
                    // (don't remove wildcard as other classes may still be in old package)
                    fileEdits.push(lsp.TextEdit.insert(
                        lsp.Position.create(i + 1, 0),
                        `import ${newQualified};\n`
                    ));
                }
            }

            if (fileEdits.length > 0) {
                changes[fileUri] = fileEdits;
            }
        }
    }

    return {
        title: `Move '${classSym.name}' to package '${newPackage}'`,
        kind: lsp.CodeActionKind.Refactor,
        edit: { changes },
    };
}

// ---------------------------------------------------------------------------
// Change Method Signature
// ---------------------------------------------------------------------------

/**
 * Create a "Change Method Signature" refactoring action.
 * Updates the method declaration and all call sites across workspace.
 */
export function createChangeSignatureAction(
    table: SymbolTable,
    text: string,
    uri: string,
    range: lsp.Range,
    change: SignatureChange,
    workspaceFiles?: Map<string, string>,
): lsp.CodeAction | null {
    // Find method at cursor
    const method = table.allSymbols.find(s =>
        (s.kind === 'method' || s.kind === 'constructor') &&
        s.line >= range.start.line && s.line <= range.end.line
    );
    if (!method) return null;

    const changes: { [uri: string]: lsp.TextEdit[] } = {};
    const edits: lsp.TextEdit[] = [];
    const oldName = method.name;
    const newName = change.newName ?? oldName;

    // 1. Rebuild the method signature line
    const lines = text.split('\n');
    const methodLine = lines[method.line];

    // Find the parameter list in the method line: between ( and )
    const parenStart = methodLine.indexOf('(');
    const parenEnd = methodLine.indexOf(')', parenStart);

    if (parenStart >= 0 && parenEnd >= 0) {
        // Build new parameter string
        const newParamStr = change.newParameters
            .map(p => `${p.type} ${p.name}`)
            .join(', ');

        // Replace the method name and parameters
        let newMethodLine = methodLine;

        // Replace parameters
        newMethodLine = newMethodLine.substring(0, parenStart + 1) + newParamStr + newMethodLine.substring(parenEnd);

        // Replace method name if changed
        if (newName !== oldName) {
            const nameStart = newMethodLine.lastIndexOf(oldName, parenStart);
            if (nameStart >= 0) {
                newMethodLine = newMethodLine.substring(0, nameStart) + newName + newMethodLine.substring(nameStart + oldName.length);
            }
        }

        // Replace return type if changed
        if (change.newReturnType && method.returnType) {
            const rtStart = newMethodLine.indexOf(method.returnType);
            if (rtStart >= 0 && rtStart < parenStart) {
                newMethodLine = newMethodLine.substring(0, rtStart) + change.newReturnType + newMethodLine.substring(rtStart + method.returnType.length);
            }
        }

        edits.push(lsp.TextEdit.replace(
            lsp.Range.create(method.line, 0, method.line, methodLine.length),
            newMethodLine
        ));
    }

    // 2. Build parameter reorder map: old param index → new param index
    const oldParams = method.parameters ?? [];
    const reorderMap: Map<number, number> = new Map();
    for (let newIdx = 0; newIdx < change.newParameters.length; newIdx++) {
        const newParam = change.newParameters[newIdx];
        const oldIdx = oldParams.findIndex(p => p.name === newParam.name);
        if (oldIdx >= 0) {
            reorderMap.set(oldIdx, newIdx);
        }
    }

    // 3. Update call sites in current file
    updateCallSites(lines, oldName, newName, oldParams, change.newParameters, reorderMap, method.line, edits);

    if (edits.length > 0) {
        changes[uri] = edits;
    }

    // 4. Update call sites in workspace files
    if (workspaceFiles) {
        for (const [fileUri, fileText] of workspaceFiles.entries()) {
            if (fileUri === uri) continue;
            const fileLines = fileText.split('\n');
            const fileEdits: lsp.TextEdit[] = [];
            updateCallSites(fileLines, oldName, newName, oldParams, change.newParameters, reorderMap, -1, fileEdits);
            if (fileEdits.length > 0) {
                changes[fileUri] = fileEdits;
            }
        }
    }

    return {
        title: `Change signature of '${oldName}'`,
        kind: lsp.CodeActionKind.Refactor,
        edit: { changes },
    };
}

function updateCallSites(
    lines: string[],
    oldName: string,
    newName: string,
    oldParams: { type: string; name: string }[],
    newParams: { type: string; name: string }[],
    reorderMap: Map<number, number>,
    skipLine: number,
    edits: lsp.TextEdit[],
): void {
    // Simple approach: find lines containing methodName( and update
    const callPattern = new RegExp(`\\b${escapeRegex(oldName)}\\s*\\(`);

    for (let i = 0; i < lines.length; i++) {
        if (i === skipLine) continue; // Skip the declaration itself
        const line = lines[i];
        if (!callPattern.test(line)) continue;

        // Find the call: name(args)
        const match = line.match(new RegExp(`\\b${escapeRegex(oldName)}(\\s*)\\(`));
        if (!match || match.index === undefined) continue;

        const nameStart = match.index;
        const parenStart = line.indexOf('(', nameStart);

        // Find matching closing paren (handle nested parens)
        let depth = 0;
        let parenEnd = -1;
        for (let j = parenStart; j < line.length; j++) {
            if (line[j] === '(') depth++;
            else if (line[j] === ')') {
                depth--;
                if (depth === 0) { parenEnd = j; break; }
            }
        }
        if (parenEnd < 0) continue;

        // Extract current arguments
        const argsStr = line.substring(parenStart + 1, parenEnd);
        const args = splitArgs(argsStr);

        // Reorder arguments according to the map
        const newArgs: string[] = new Array(newParams.length).fill('/* TODO */');
        for (const [oldIdx, newIdx] of reorderMap.entries()) {
            if (oldIdx < args.length) {
                newArgs[newIdx] = args[oldIdx].trim();
            }
        }

        // For new parameters not mapped from old ones, add placeholder
        for (let j = 0; j < newParams.length; j++) {
            if (newArgs[j] === '/* TODO */') {
                // Check if there's an arg at the same position from old that wasn't mapped
                if (j < args.length && !reorderMap.has(j)) {
                    newArgs[j] = args[j].trim();
                }
            }
        }

        const newCallStr = `${newName}${match[1]}(${newArgs.join(', ')})`;
        edits.push(lsp.TextEdit.replace(
            lsp.Range.create(i, nameStart, i, parenEnd + 1),
            newCallStr
        ));
    }
}

function splitArgs(argsStr: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of argsStr) {
        if (ch === '(' || ch === '<') depth++;
        else if (ch === ')' || ch === '>') depth--;
        else if (ch === ',' && depth === 0) {
            args.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) args.push(current);
    return args;
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
