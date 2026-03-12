/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { SymbolTable, JavaSymbol } from '../java/symbol-table.js';
import { findSymbolAtPosition, resolveSymbolByName } from '../java/scope-resolver.js';
import { getTokenAtPosition } from './token-utils.js';
import { getJdkType } from '../project/jdk-model.js';
import type { CstNode } from 'chevrotain';

/**
 * Provide hover information for a symbol at the given position.
 */
export function provideHover(
    cst: CstNode,
    table: SymbolTable,
    text: string,
    line: number,
    character: number,
): lsp.Hover | null {
    const token = getTokenAtPosition(cst, line, character);
    if (!token) return null;

    const tokenName = token.image;

    // Try to find by exact position first
    let sym = findSymbolAtPosition(table, line, character);

    // If the token is an identifier and doesn't match the positional symbol, resolve by name
    if (!sym || (sym.name !== tokenName && token.tokenType?.name === 'Identifier')) {
        sym = resolveSymbolByName(table, tokenName, line, character);
    }

    const startLine = Number.isFinite(token.startLine) ? token.startLine! - 1 : 0;
    const startCol = Number.isFinite(token.startColumn) ? token.startColumn! - 1 : 0;
    const endLine = Number.isFinite(token.endLine) ? token.endLine! - 1 : startLine;
    const endCol = Number.isFinite(token.endColumn) ? token.endColumn! : startCol;

    const range = lsp.Range.create(startLine, startCol, endLine, endCol);

    if (sym) {
        return { contents: formatSymbolHover(sym), range };
    }

    // Try JDK types
    const jdkType = getJdkType(tokenName);
    if (jdkType) {
        const typeParams = jdkType.typeParameters ? `<${jdkType.typeParameters.join(', ')}>` : '';
        const superInfo = jdkType.superclass ? ` extends ${jdkType.superclass}` : '';
        const ifaceInfo = jdkType.interfaces?.length ? ` implements ${jdkType.interfaces.join(', ')}` : '';
        const sig = `${jdkType.kind} ${jdkType.name}${typeParams}${superInfo}${ifaceInfo}`;
        const desc = jdkType.description ? `\n\n${jdkType.description}` : '';
        return {
            contents: {
                kind: lsp.MarkupKind.Markdown,
                value: `\`\`\`java\n${sig}\n\`\`\`\n\nFrom: \`${jdkType.qualifiedName}\`${desc}`,
            },
            range,
        };
    }

    return null;
}

function formatSymbolHover(sym: JavaSymbol): lsp.MarkupContent {
    const lines: string[] = [];

    switch (sym.kind) {
        case 'class':
        case 'interface':
        case 'enum':
        case 'record': {
            const mods = sym.modifiers.length > 0 ? sym.modifiers.join(' ') + ' ' : '';
            lines.push(`${mods}${sym.kind} ${sym.name}`);
            break;
        }
        case 'method': {
            const mods = sym.modifiers.length > 0 ? sym.modifiers.join(' ') + ' ' : '';
            const params = sym.parameters?.map(p => `${p.type} ${p.name}`).join(', ') ?? '';
            lines.push(`${mods}${sym.returnType ?? 'void'} ${sym.name}(${params})`);
            break;
        }
        case 'constructor': {
            const mods = sym.modifiers.length > 0 ? sym.modifiers.join(' ') + ' ' : '';
            const params = sym.parameters?.map(p => `${p.type} ${p.name}`).join(', ') ?? '';
            lines.push(`${mods}${sym.name}(${params})`);
            break;
        }
        case 'field':
        case 'variable':
        case 'parameter': {
            const mods = sym.modifiers.length > 0 ? sym.modifiers.join(' ') + ' ' : '';
            lines.push(`${mods}${sym.type ?? 'Object'} ${sym.name}`);
            break;
        }
        case 'enumConstant': {
            lines.push(`${sym.parent ?? ''}.${sym.name}`);
            break;
        }
    }

    if (sym.parent) {
        lines.push(`\nDefined in: ${sym.parent}`);
    }

    return {
        kind: lsp.MarkupKind.Markdown,
        value: '```java\n' + lines[0] + '\n```' + (lines.length > 1 ? '\n' + lines.slice(1).join('\n') : ''),
    };
}
