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
import { getAllJdkTypes, type JdkType } from '../project/jdk-model.js';

const JAVA_KEYWORDS = [
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
    'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
    'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
    'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
    'package', 'private', 'protected', 'public', 'return', 'short', 'static',
    'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
    'transient', 'try', 'void', 'volatile', 'while', 'yield', 'var', 'record',
    'sealed', 'permits', 'non-sealed',
];

const JAVA_SNIPPETS: lsp.CompletionItem[] = [
    {
        label: 'sout',
        kind: lsp.CompletionItemKind.Snippet,
        insertText: 'System.out.println(${1});',
        insertTextFormat: lsp.InsertTextFormat.Snippet,
        detail: 'System.out.println()',
        documentation: 'Print to standard output',
    },
    {
        label: 'serr',
        kind: lsp.CompletionItemKind.Snippet,
        insertText: 'System.err.println(${1});',
        insertTextFormat: lsp.InsertTextFormat.Snippet,
        detail: 'System.err.println()',
        documentation: 'Print to standard error',
    },
    {
        label: 'main',
        kind: lsp.CompletionItemKind.Snippet,
        insertText: 'public static void main(String[] args) {\n\t${1}\n}',
        insertTextFormat: lsp.InsertTextFormat.Snippet,
        detail: 'public static void main(String[] args)',
        documentation: 'Main method',
    },
    {
        label: 'fori',
        kind: lsp.CompletionItemKind.Snippet,
        insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {\n\t${3}\n}',
        insertTextFormat: lsp.InsertTextFormat.Snippet,
        detail: 'for (int i = 0; i < ...; i++)',
        documentation: 'Indexed for loop',
    },
    {
        label: 'foreach',
        kind: lsp.CompletionItemKind.Snippet,
        insertText: 'for (${1:Type} ${2:item} : ${3:collection}) {\n\t${4}\n}',
        insertTextFormat: lsp.InsertTextFormat.Snippet,
        detail: 'for (Type item : collection)',
        documentation: 'Enhanced for loop',
    },
    {
        label: 'if',
        kind: lsp.CompletionItemKind.Snippet,
        insertText: 'if (${1:condition}) {\n\t${2}\n}',
        insertTextFormat: lsp.InsertTextFormat.Snippet,
        detail: 'if statement',
    },
    {
        label: 'ifelse',
        kind: lsp.CompletionItemKind.Snippet,
        insertText: 'if (${1:condition}) {\n\t${2}\n} else {\n\t${3}\n}',
        insertTextFormat: lsp.InsertTextFormat.Snippet,
        detail: 'if-else statement',
    },
    {
        label: 'try',
        kind: lsp.CompletionItemKind.Snippet,
        insertText: 'try {\n\t${1}\n} catch (${2:Exception} ${3:e}) {\n\t${4}\n}',
        insertTextFormat: lsp.InsertTextFormat.Snippet,
        detail: 'try-catch block',
    },
    {
        label: 'trycatch',
        kind: lsp.CompletionItemKind.Snippet,
        insertText: 'try {\n\t${1}\n} catch (${2:Exception} ${3:e}) {\n\t${4:e.printStackTrace();}\n}',
        insertTextFormat: lsp.InsertTextFormat.Snippet,
        detail: 'try-catch with printStackTrace',
    },
    {
        label: 'while',
        kind: lsp.CompletionItemKind.Snippet,
        insertText: 'while (${1:condition}) {\n\t${2}\n}',
        insertTextFormat: lsp.InsertTextFormat.Snippet,
        detail: 'while loop',
    },
    {
        label: 'switch',
        kind: lsp.CompletionItemKind.Snippet,
        insertText: 'switch (${1:expression}) {\n\tcase ${2:value}:\n\t\t${3}\n\t\tbreak;\n\tdefault:\n\t\t${4}\n\t\tbreak;\n}',
        insertTextFormat: lsp.InsertTextFormat.Snippet,
        detail: 'switch statement',
    },
];

/**
 * Provide completion items at the given position.
 */
export function provideCompletions(
    table: SymbolTable,
    line: number,
    character: number,
): lsp.CompletionItem[] {
    const items: lsp.CompletionItem[] = [];

    // Add visible symbols from scope
    const visible = findVisibleSymbols(table, line, character);
    const seen = new Set<string>();

    for (const sym of visible) {
        if (seen.has(sym.name)) continue;
        seen.add(sym.name);

        const item: lsp.CompletionItem = {
            label: sym.name,
            kind: symbolKindToCompletionKind(sym.kind),
            detail: formatSymbolDetail(sym),
            sortText: getSortPrefix(sym.kind) + sym.name,
        };
        items.push(item);
    }

    // Add Java keywords
    for (const kw of JAVA_KEYWORDS) {
        items.push({
            label: kw,
            kind: lsp.CompletionItemKind.Keyword,
            sortText: '3_' + kw,
        });
    }

    // Add snippets
    for (const snippet of JAVA_SNIPPETS) {
        items.push({ ...snippet, sortText: '4_' + snippet.label });
    }

    // Add JDK standard library types
    for (const jdkType of getAllJdkTypes()) {
        if (seen.has(jdkType.name)) continue;
        seen.add(jdkType.name);
        items.push({
            label: jdkType.name,
            kind: jdkTypeToCompletionKind(jdkType),
            detail: jdkType.qualifiedName,
            documentation: jdkType.description,
            sortText: '2_' + jdkType.name,
        });
    }

    return items;
}

function symbolKindToCompletionKind(kind: string): lsp.CompletionItemKind {
    switch (kind) {
        case 'class': return lsp.CompletionItemKind.Class;
        case 'interface': return lsp.CompletionItemKind.Interface;
        case 'enum': return lsp.CompletionItemKind.Enum;
        case 'record': return lsp.CompletionItemKind.Struct;
        case 'method': return lsp.CompletionItemKind.Method;
        case 'constructor': return lsp.CompletionItemKind.Constructor;
        case 'field': return lsp.CompletionItemKind.Field;
        case 'variable': return lsp.CompletionItemKind.Variable;
        case 'parameter': return lsp.CompletionItemKind.Variable;
        case 'enumConstant': return lsp.CompletionItemKind.EnumMember;
        default: return lsp.CompletionItemKind.Text;
    }
}

function formatSymbolDetail(sym: { kind: string; type?: string; returnType?: string; parameters?: { type: string; name: string }[] }): string {
    switch (sym.kind) {
        case 'method': {
            const params = sym.parameters?.map(p => `${p.type} ${p.name}`).join(', ') ?? '';
            return `${sym.returnType ?? 'void'} (${params})`;
        }
        case 'constructor': {
            const params = sym.parameters?.map(p => `${p.type} ${p.name}`).join(', ') ?? '';
            return `(${params})`;
        }
        case 'field':
        case 'variable':
        case 'parameter':
            return sym.type ?? 'Object';
        default:
            return sym.kind;
    }
}

function getSortPrefix(kind: string): string {
    switch (kind) {
        case 'variable':
        case 'parameter': return '0_';
        case 'field': return '1_';
        case 'method':
        case 'constructor': return '1_';
        case 'class':
        case 'interface':
        case 'enum':
        case 'record': return '2_';
        default: return '2_';
    }
}

function jdkTypeToCompletionKind(jdkType: JdkType): lsp.CompletionItemKind {
    switch (jdkType.kind) {
        case 'class': return lsp.CompletionItemKind.Class;
        case 'interface': return lsp.CompletionItemKind.Interface;
        case 'enum': return lsp.CompletionItemKind.Enum;
        case 'annotation': return lsp.CompletionItemKind.Interface;
        default: return lsp.CompletionItemKind.Class;
    }
}
