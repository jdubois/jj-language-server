/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { SymbolTable, JavaSymbol } from '../java/symbol-table.js';

/**
 * Provide type hierarchy (supertypes and subtypes).
 */

export function prepareTypeHierarchy(
    table: SymbolTable,
    uri: string,
    line: number,
    character: number,
): lsp.TypeHierarchyItem[] | null {
    // Find the type at the cursor position
    const sym = table.allSymbols.find(s =>
        ['class', 'interface', 'enum', 'record'].includes(s.kind) &&
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
): lsp.TypeHierarchyItem[] {
    // Find the type declaration
    const sym = table.allSymbols.find(s =>
        s.name === item.name && ['class', 'interface', 'enum', 'record'].includes(s.kind),
    );

    if (!sym) return [];

    const supertypes: lsp.TypeHierarchyItem[] = [];

    // Look for "extends" info in modifiers or symbol metadata
    // For now, we can check other types in the same file
    for (const other of table.allSymbols) {
        if (!['class', 'interface'].includes(other.kind)) continue;
        if (other.name === sym.name) continue;
        // This is a simplified implementation — a full one would parse extends/implements
    }

    return supertypes;
}

export function provideSubtypes(
    table: SymbolTable,
    uri: string,
    item: lsp.TypeHierarchyItem,
): lsp.TypeHierarchyItem[] {
    const subtypes: lsp.TypeHierarchyItem[] = [];

    // Check for types that reference the target type (simplified)
    // A full implementation would track extends/implements relationships

    return subtypes;
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
