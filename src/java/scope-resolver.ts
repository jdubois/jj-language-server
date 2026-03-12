/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { JavaSymbol, SymbolTable } from './symbol-table.js';

/**
 * Find the symbol at a given position (0-based line and column).
 */
export function findSymbolAtPosition(table: SymbolTable, line: number, column: number): JavaSymbol | undefined {
    // Search all symbols; find the most specific (deepest) one that contains the position
    let best: JavaSymbol | undefined;

    for (const sym of table.allSymbols) {
        if (containsPosition(sym, line, column)) {
            if (!best || isMoreSpecific(sym, best)) {
                best = sym;
            }
        }
    }

    return best;
}

/**
 * Find all symbols visible at a given position.
 * Includes: enclosing class members, local variables declared before position,
 * parameters of enclosing method/constructor.
 */
export function findVisibleSymbols(table: SymbolTable, line: number, column: number): JavaSymbol[] {
    const visible: JavaSymbol[] = [];

    // Find the enclosing context
    const enclosingMethod = findEnclosingSymbol(table, line, column, ['method', 'constructor']);
    const enclosingClass = findEnclosingSymbol(table, line, column, ['class', 'interface', 'enum', 'record']);

    // Add method parameters
    if (enclosingMethod?.parameters) {
        for (const param of enclosingMethod.parameters) {
            visible.push({
                name: param.name,
                kind: 'parameter',
                type: param.type,
                modifiers: [],
                line: enclosingMethod.line,
                column: enclosingMethod.column,
                endLine: enclosingMethod.endLine,
                endColumn: enclosingMethod.endColumn,
                children: [],
            });
        }
    }

    // Add local variables declared before the position
    if (enclosingMethod) {
        for (const child of enclosingMethod.children) {
            if (child.kind === 'variable' && isBeforeOrAt(child, line, column)) {
                visible.push(child);
            }
        }
    }

    // Add class members
    if (enclosingClass) {
        for (const child of enclosingClass.children) {
            if (['method', 'field', 'constructor', 'class', 'interface', 'enum', 'enumConstant'].includes(child.kind)) {
                visible.push(child);
            }
        }
    }

    // Add top-level types
    for (const sym of table.symbols) {
        visible.push(sym);
    }

    return visible;
}

/**
 * Find a symbol by name among visible symbols at a position.
 */
export function resolveSymbolByName(table: SymbolTable, name: string, line: number, column: number): JavaSymbol | undefined {
    const visible = findVisibleSymbols(table, line, column);
    return visible.find(s => s.name === name);
}

/**
 * Find all references to a symbol name within the symbol table.
 */
export function findSymbolsByName(table: SymbolTable, name: string): JavaSymbol[] {
    return table.allSymbols.filter(s => s.name === name);
}

// --- Helpers ---

function findEnclosingSymbol(table: SymbolTable, line: number, column: number, kinds: string[]): JavaSymbol | undefined {
    let best: JavaSymbol | undefined;
    for (const sym of table.allSymbols) {
        if (kinds.includes(sym.kind) && containsPosition(sym, line, column)) {
            if (!best || isMoreSpecific(sym, best)) {
                best = sym;
            }
        }
    }
    return best;
}

function containsPosition(sym: JavaSymbol, line: number, column: number): boolean {
    if (line < sym.line || line > sym.endLine) return false;
    if (line === sym.line && column < sym.column) return false;
    if (line === sym.endLine && column > sym.endColumn) return false;
    return true;
}

function isMoreSpecific(a: JavaSymbol, b: JavaSymbol): boolean {
    // A is more specific if it starts after or at the same position as B
    // and ends before or at the same position
    const aSize = (a.endLine - a.line) * 10000 + (a.endColumn - a.column);
    const bSize = (b.endLine - b.line) * 10000 + (b.endColumn - b.column);
    return aSize <= bSize;
}

function isBeforeOrAt(sym: JavaSymbol, line: number, column: number): boolean {
    if (sym.line < line) return true;
    if (sym.line === line && sym.column <= column) return true;
    return false;
}
