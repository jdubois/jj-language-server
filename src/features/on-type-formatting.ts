/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';

/**
 * Provide on-type formatting: auto-indent after opening brace,
 * auto-close brace after enter, and semicolon formatting.
 */
export function provideOnTypeFormatting(
    text: string,
    position: lsp.Position,
    ch: string,
    options: lsp.FormattingOptions,
): lsp.TextEdit[] {
    const lines = text.split('\n');
    const indent = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';

    if (ch === '\n') {
        return handleNewline(lines, position, indent);
    }

    if (ch === '}') {
        return handleCloseBrace(lines, position, indent);
    }

    if (ch === ';') {
        return handleSemicolon(lines, position);
    }

    return [];
}

function handleNewline(lines: string[], position: lsp.Position, indent: string): lsp.TextEdit[] {
    const prevLineIdx = position.line - 1;
    if (prevLineIdx < 0) return [];

    const prevLine = lines[prevLineIdx];
    const trimmed = prevLine.trimEnd();
    const currentIndent = getIndentation(prevLine);

    // After opening brace: indent + auto-close
    if (trimmed.endsWith('{')) {
        const edits: lsp.TextEdit[] = [];
        const newIndent = currentIndent + indent;
        const currentLine = lines[position.line] ?? '';

        // If the next line is just a closing brace, maintain format
        if (currentLine.trim() === '}') {
            edits.push(lsp.TextEdit.replace(
                lsp.Range.create(position.line, 0, position.line, currentLine.length),
                newIndent + '\n' + currentIndent + '}',
            ));
        } else if (!hasMatchingCloseBrace(lines, prevLineIdx)) {
            // Auto-close brace
            edits.push(lsp.TextEdit.insert(
                lsp.Position.create(position.line, 0),
                newIndent + '\n' + currentIndent + '}\n',
            ));
        } else {
            // Just add indentation
            edits.push(lsp.TextEdit.insert(
                lsp.Position.create(position.line, 0),
                newIndent,
            ));
        }
        return edits;
    }

    return [];
}

function handleCloseBrace(lines: string[], position: lsp.Position, indent: string): lsp.TextEdit[] {
    const currentLine = lines[position.line] ?? '';
    const trimmed = currentLine.trim();

    // Only re-indent if the line is just a closing brace
    if (trimmed !== '}') return [];

    // Find the matching opening brace to determine correct indentation
    const matchLine = findMatchingOpenBrace(lines, position.line);
    if (matchLine >= 0) {
        const matchIndent = getIndentation(lines[matchLine]);
        const currentIndent = getIndentation(currentLine);
        if (currentIndent !== matchIndent) {
            return [lsp.TextEdit.replace(
                lsp.Range.create(position.line, 0, position.line, currentLine.length),
                matchIndent + '}',
            )];
        }
    }

    return [];
}

function handleSemicolon(lines: string[], position: lsp.Position): lsp.TextEdit[] {
    // Remove extra whitespace before semicolon
    const line = lines[position.line] ?? '';
    const before = line.substring(0, position.character);
    const trimmedBefore = before.trimEnd();
    if (trimmedBefore.length < before.length - 1) {
        return [lsp.TextEdit.replace(
            lsp.Range.create(position.line, trimmedBefore.length, position.line, position.character),
            '',
        )];
    }
    return [];
}

function getIndentation(line: string): string {
    const match = line.match(/^(\s*)/);
    return match ? match[1] : '';
}

function hasMatchingCloseBrace(lines: string[], openLine: number): boolean {
    let depth = 0;
    for (let i = openLine; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            if (ch === '}') depth--;
            if (depth === 0 && i > openLine) return true;
        }
    }
    return false;
}

function findMatchingOpenBrace(lines: string[], closeLine: number): number {
    let depth = 0;
    for (let i = closeLine; i >= 0; i--) {
        const line = lines[i];
        for (let j = line.length - 1; j >= 0; j--) {
            if (line[j] === '}') depth++;
            if (line[j] === '{') {
                depth--;
                if (depth === 0) return i;
            }
        }
    }
    return -1;
}
