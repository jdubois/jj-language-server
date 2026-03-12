/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { SymbolTable, JavaSymbol } from '../java/symbol-table.js';
import type { WorkspaceIndex } from '../project/workspace-index.js';

/**
 * Provide type hierarchy (supertypes and subtypes).
 */

const TYPE_KINDS = ['class', 'interface', 'enum', 'record'];

export function prepareTypeHierarchy(
    table: SymbolTable,
    uri: string,
    line: number,
    character: number,
): lsp.TypeHierarchyItem[] | null {
    // Find the type at the cursor position
    const sym = table.allSymbols.find(s =>
        TYPE_KINDS.includes(s.kind) &&
        s.line <= line && s.endLine >= line,
    );

    if (!sym) return null;

    return [{
        name: sym.name,
        kind: typeKindToSymbolKind(sym.kind),
        uri,
        range: lsp.Range.create(sym.line, sym.column, sym.endLine, sym.endColumn),
        selectionRange: lsp.Range.create(sym.line, sym.column, sym.line, sym.column + sym.name.length),
        detail: sym.parent,
    }];
}

export function provideSupertypes(
    table: SymbolTable,
    uri: string,
    item: lsp.TypeHierarchyItem,
    workspaceIndex?: WorkspaceIndex,
): lsp.TypeHierarchyItem[] {
    const sym = table.allSymbols.find(s =>
        s.name === item.name && TYPE_KINDS.includes(s.kind),
    );

    if (!sym) return [];

    const supertypes: lsp.TypeHierarchyItem[] = [];
    const supertypeNames: string[] = [];

    if (sym.superclass) {
        supertypeNames.push(sym.superclass);
    }
    if (sym.interfaces) {
        supertypeNames.push(...sym.interfaces);
    }

    for (const name of supertypeNames) {
        const resolved = resolveType(name, table, uri, workspaceIndex);
        if (resolved) {
            supertypes.push(resolved);
        }
    }

    return supertypes;
}

export function provideSubtypes(
    table: SymbolTable,
    uri: string,
    item: lsp.TypeHierarchyItem,
    workspaceIndex?: WorkspaceIndex,
): lsp.TypeHierarchyItem[] {
    const subtypes: lsp.TypeHierarchyItem[] = [];
    const seen = new Set<string>();

    collectSubtypes(table, uri, item.name, subtypes, seen);

    if (workspaceIndex) {
        for (const fileUri of workspaceIndex.getFileUris()) {
            if (fileUri === uri) continue;
            const fileTable = workspaceIndex.getSymbolTable(fileUri);
            if (!fileTable) continue;
            collectSubtypes(fileTable, fileUri, item.name, subtypes, seen);
        }
    }

    return subtypes;
}

function collectSubtypes(
    table: SymbolTable,
    tableUri: string,
    targetName: string,
    results: lsp.TypeHierarchyItem[],
    seen: Set<string>,
): void {
    for (const sym of table.allSymbols) {
        if (!TYPE_KINDS.includes(sym.kind)) continue;
        if (seen.has(`${tableUri}#${sym.name}`)) continue;

        const isSubtype =
            sym.superclass === targetName ||
            sym.interfaces?.includes(targetName);

        if (isSubtype) {
            seen.add(`${tableUri}#${sym.name}`);
            results.push(symbolToHierarchyItem(sym, tableUri));
        }
    }
}

function resolveType(
    name: string,
    table: SymbolTable,
    uri: string,
    workspaceIndex?: WorkspaceIndex,
): lsp.TypeHierarchyItem | undefined {
    // Search current file first
    const local = table.allSymbols.find(s =>
        TYPE_KINDS.includes(s.kind) && s.name === name,
    );
    if (local) {
        return symbolToHierarchyItem(local, uri);
    }

    // Search workspace index
    if (workspaceIndex) {
        const entry = workspaceIndex.findTypeByName(name);
        if (entry) {
            return {
                name: entry.name,
                kind: typeKindToSymbolKind(entry.kind),
                uri: entry.uri,
                range: lsp.Range.create(entry.line, entry.column, entry.line, entry.column + entry.name.length),
                selectionRange: lsp.Range.create(entry.line, entry.column, entry.line, entry.column + entry.name.length),
                detail: entry.containerName,
            };
        }
    }

    return undefined;
}

function symbolToHierarchyItem(sym: JavaSymbol, uri: string): lsp.TypeHierarchyItem {
    return {
        name: sym.name,
        kind: typeKindToSymbolKind(sym.kind),
        uri,
        range: lsp.Range.create(sym.line, sym.column, sym.endLine, sym.endColumn),
        selectionRange: lsp.Range.create(sym.line, sym.column, sym.line, sym.column + sym.name.length),
        detail: sym.parent,
    };
}

function typeKindToSymbolKind(kind: string): lsp.SymbolKind {
    switch (kind) {
        case 'class': return lsp.SymbolKind.Class;
        case 'interface': return lsp.SymbolKind.Interface;
        case 'enum': return lsp.SymbolKind.Enum;
        case 'record': return lsp.SymbolKind.Struct;
        default: return lsp.SymbolKind.Class;
    }
}
