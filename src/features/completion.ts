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
import { formatJavadocMarkdown, type JavadocComment } from '../java/javadoc.js';

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
    text?: string,
    javadocMap?: Map<number, JavadocComment>,
): lsp.CompletionItem[] {
    const items: lsp.CompletionItem[] = [];

    // Pre-compute import insert location if text is available
    const importInsertLine = text ? findImportInsertLine(text.split('\n')) : 0;
    const existingImports = text ? extractImportedNames(text) : new Set<string>();

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

        if (javadocMap) {
            const javadoc = javadocMap.get(sym.line + 1);
            if (javadoc) {
                item.documentation = { kind: lsp.MarkupKind.Markdown, value: formatJavadocMarkdown(javadoc) };
            }
        }

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

    // Add JDK standard library types with auto-import
    for (const jdkType of getAllJdkTypes()) {
        if (seen.has(jdkType.name)) continue;
        seen.add(jdkType.name);

        const item: lsp.CompletionItem = {
            label: jdkType.name,
            kind: jdkTypeToCompletionKind(jdkType),
            detail: jdkType.qualifiedName,
            documentation: jdkType.description,
            sortText: '2_' + jdkType.name,
        };

        // Auto-import: add import statement when completing a non-java.lang type
        if (text && jdkType.package !== 'java.lang' && !existingImports.has(jdkType.name)) {
            item.additionalTextEdits = [
                lsp.TextEdit.insert(
                    lsp.Position.create(importInsertLine, 0),
                    `import ${jdkType.qualifiedName};\n`,
                ),
            ];
        }

        items.push(item);
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
