/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { SymbolTable } from '../java/symbol-table.js';
import { findVisibleSymbols } from '../java/scope-resolver.js';

/**
 * Provide signature help when inside method call parentheses.
 */
export function provideSignatureHelp(
    table: SymbolTable,
    text: string,
    line: number,
    character: number,
): lsp.SignatureHelp | null {
    // Find the method name before the opening parenthesis
    const methodCall = findMethodCallContext(text, line, character);
    if (!methodCall) return null;

    const { methodName, activeParameter } = methodCall;

    // Find matching methods
    const visible = findVisibleSymbols(table, line, character);
    const matchingMethods = visible.filter(
        s => s.name === methodName && (s.kind === 'method' || s.kind === 'constructor'),
    );

    if (matchingMethods.length === 0) return null;

    const signatures: lsp.SignatureInformation[] = matchingMethods.map(method => {
        const params = method.parameters?.map(p => ({
            label: `${p.type} ${p.name}`,
        })) ?? [];

        const paramStr = method.parameters?.map(p => `${p.type} ${p.name}`).join(', ') ?? '';
        const returnStr = method.kind === 'method' ? `${method.returnType ?? 'void'} ` : '';

        return {
            label: `${returnStr}${method.name}(${paramStr})`,
            parameters: params,
        };
    });

    // Pick the best-matching overload based on argument count
    const argCount = activeParameter + 1;
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < signatures.length; i++) {
        const paramCount = signatures[i].parameters?.length ?? 0;
        // Prefer overloads that have at least as many params as current arg count
        const distance = paramCount >= argCount
            ? paramCount - argCount
            : (argCount - paramCount) + 1000; // penalize too-few params
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }

    return {
        signatures,
        activeSignature: bestIndex,
        activeParameter,
    };
}

interface MethodCallContext {
    methodName: string;
    activeParameter: number;
}

function findMethodCallContext(text: string, line: number, character: number): MethodCallContext | null {
    const lines = text.split('\n');
    if (line >= lines.length) return null;

    // Build text up to cursor position
    let offset = 0;
    for (let i = 0; i < line; i++) {
        offset += lines[i].length + 1;
    }
    offset += character;

    // Walk backwards from cursor to find opening parenthesis
    let depth = 0;
    let commaCount = 0;
    let parenPos = -1;

    for (let i = offset - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === ')') {
            depth++;
        } else if (ch === '(') {
            if (depth === 0) {
                parenPos = i;
                break;
            }
            depth--;
        } else if (ch === ',' && depth === 0) {
            commaCount++;
        }
    }

    if (parenPos < 0) return null;

    // Extract method name before the parenthesis
    let nameEnd = parenPos;
    while (nameEnd > 0 && text[nameEnd - 1] === ' ') nameEnd--;

    let nameStart = nameEnd;
    while (nameStart > 0 && /[a-zA-Z0-9_$]/.test(text[nameStart - 1])) {
        nameStart--;
    }

    const methodName = text.substring(nameStart, nameEnd);
    if (!methodName || !/^[a-zA-Z_$]/.test(methodName)) return null;

    return {
        methodName,
        activeParameter: commaCount,
    };
}
