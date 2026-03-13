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
 * Provide source generation code actions for a class at the given range.
 */
export function provideSourceGenerationActions(
    table: SymbolTable,
    text: string,
    range: lsp.Range,
    uri: string,
): lsp.CodeAction[] {
    const actions: lsp.CodeAction[] = [];
    const classSym = findEnclosingClass(table, range.start.line, range.start.character);
    if (!classSym) return actions;

    const fields = classSym.children.filter(c => c.kind === 'field');
    if (fields.length === 0) return actions;

    const insertPos = findInsertPosition(text, classSym);

    // Generate constructor from all fields
    const hasConstructor = classSym.children.some(c => c.kind === 'constructor');
    if (!hasConstructor) {
        const ctorText = generateConstructor(classSym.name, fields);
        actions.push(createCodeAction(
            `Generate constructor using all fields`,
            uri, insertPos, ctorText,
            lsp.CodeActionKind.Refactor,
        ));
    }

    // Generate no-args constructor
    const hasNoArgsCtor = classSym.children.some(c =>
        c.kind === 'constructor' && (!c.parameters || c.parameters.length === 0),
    );
    if (!hasNoArgsCtor && fields.length > 0) {
        const noArgsCtor = generateNoArgsConstructor(classSym.name);
        actions.push(createCodeAction(
            `Generate no-args constructor`,
            uri, insertPos, noArgsCtor,
            lsp.CodeActionKind.Refactor,
        ));
    }

    // Generate getters and setters
    const existingMethods = new Set(
        classSym.children.filter(c => c.kind === 'method').map(c => c.name),
    );

    const fieldsNeedingGetters = fields.filter(f => !existingMethods.has(getterName(f)));
    const fieldsNeedingSetters = fields.filter(f =>
        !existingMethods.has(setterName(f)) && !f.modifiers.includes('final'),
    );

    if (fieldsNeedingGetters.length > 0) {
        const getters = fieldsNeedingGetters.map(f => generateGetter(f)).join('\n');
        actions.push(createCodeAction(
            `Generate getters`,
            uri, insertPos, getters,
            lsp.CodeActionKind.Refactor,
        ));
    }

    if (fieldsNeedingSetters.length > 0) {
        const setters = fieldsNeedingSetters.map(f => generateSetter(f)).join('\n');
        actions.push(createCodeAction(
            `Generate setters`,
            uri, insertPos, setters,
            lsp.CodeActionKind.Refactor,
        ));
    }

    if (fieldsNeedingGetters.length > 0 && fieldsNeedingSetters.length > 0) {
        const both = [
            ...fieldsNeedingGetters.map(f => generateGetter(f)),
            ...fieldsNeedingSetters.map(f => generateSetter(f)),
        ].join('\n');
        actions.push(createCodeAction(
            `Generate getters and setters`,
            uri, insertPos, both,
            lsp.CodeActionKind.Refactor,
        ));
    }

    // Generate toString
    if (!existingMethods.has('toString')) {
        const toStr = generateToString(classSym.name, fields);
        actions.push(createCodeAction(
            `Generate toString()`,
            uri, insertPos, toStr,
            lsp.CodeActionKind.Refactor,
        ));
    }

    // Generate equals and hashCode
    if (!existingMethods.has('equals') && !existingMethods.has('hashCode')) {
        const eqHash = generateEqualsAndHashCode(classSym.name, fields);
        actions.push(createCodeAction(
            `Generate equals() and hashCode()`,
            uri, insertPos, eqHash,
            lsp.CodeActionKind.Refactor,
        ));
    }

    // Generate override stubs for known JDK superclass/interface methods
    const overrideStubs = generateOverrideStubs(classSym, existingMethods);
    if (overrideStubs) {
        actions.push(createCodeAction(
            `Generate method override stubs`,
            uri, insertPos, overrideStubs,
            lsp.CodeActionKind.Refactor,
        ));
    }

    return actions;
}

// --- Code Generators ---

function generateConstructor(className: string, fields: JavaSymbol[]): string {
    const params = fields.map(f => `${f.type ?? 'Object'} ${f.name}`).join(', ');
    const assignments = fields.map(f => `        this.${f.name} = ${f.name};`).join('\n');
    return `\n    public ${className}(${params}) {\n${assignments}\n    }\n`;
}

function generateNoArgsConstructor(className: string): string {
    return `\n    public ${className}() {\n    }\n`;
}

function generateGetter(field: JavaSymbol): string {
    const name = getterName(field);
    const type = field.type ?? 'Object';
    return `\n    public ${type} ${name}() {\n        return this.${field.name};\n    }\n`;
}

function generateSetter(field: JavaSymbol): string {
    const name = setterName(field);
    const type = field.type ?? 'Object';
    return `\n    public void ${name}(${type} ${field.name}) {\n        this.${field.name} = ${field.name};\n    }\n`;
}

function generateToString(className: string, fields: JavaSymbol[]): string {
    const fieldExprs = fields.map(f => `"${f.name}=" + ${f.name}`).join(' + ", " + ');
    return `\n    @Override\n    public String toString() {\n        return "${className}{" + ${fieldExprs} + "}";\n    }\n`;
}

function generateEqualsAndHashCode(className: string, fields: JavaSymbol[]): string {
    const fieldComparisons = fields.map(f => {
        const type = f.type ?? 'Object';
        if (['int', 'long', 'short', 'byte', 'char', 'boolean', 'float', 'double'].includes(type)) {
            return `this.${f.name} == other.${f.name}`;
        }
        return `java.util.Objects.equals(this.${f.name}, other.${f.name})`;
    }).join(' &&\n                ');

    const hashFields = fields.map(f => `this.${f.name}`).join(', ');

    const equals = `\n    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ${className} other = (${className}) o;
        return ${fieldComparisons};
    }\n`;

    const hashCode = `\n    @Override
    public int hashCode() {
        return java.util.Objects.hash(${hashFields});
    }\n`;

    return equals + hashCode;
}

function generateOverrideStubs(classSym: JavaSymbol, existingMethods: Set<string>): string | null {
    // Look for known interfaces/superclasses in the symbol's context
    // For now, check JDK model for common types
    const stubs: string[] = [];

    // Check if the class extends/implements any known JDK type
    // We look at the CST through symbol info — limited but useful
    const commonOverrides = [
        { iface: 'Comparable', method: 'compareTo', returnType: 'int', param: `${classSym.name} o` },
        { iface: 'Runnable', method: 'run', returnType: 'void', param: '' },
        { iface: 'Callable', method: 'call', returnType: 'Object', param: '' },
        { iface: 'Iterable', method: 'iterator', returnType: 'Iterator', param: '' },
        { iface: 'AutoCloseable', method: 'close', returnType: 'void', param: '' },
        { iface: 'Cloneable', method: 'clone', returnType: 'Object', param: '' },
    ];

    // Only generate if not already present
    for (const override of commonOverrides) {
        if (!existingMethods.has(override.method)) {
            // We can't easily check implements from SymbolTable alone,
            // so we skip interface checking and only offer these as optional stubs
        }
    }

    return stubs.length > 0 ? stubs.join('\n') : null;
}

// --- Helpers ---

function getterName(field: JavaSymbol): string {
    const type = field.type ?? 'Object';
    const prefix = type === 'boolean' ? 'is' : 'get';
    return prefix + capitalize(field.name);
}

function setterName(field: JavaSymbol): string {
    return 'set' + capitalize(field.name);
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function findEnclosingClass(table: SymbolTable, line: number, character: number): JavaSymbol | undefined {
    let best: JavaSymbol | undefined;
    for (const sym of table.allSymbols) {
        if (!['class', 'record', 'enum'].includes(sym.kind)) continue;
        if (line < sym.line || line > sym.endLine) continue;
        if (line === sym.line && character < sym.column) continue;
        if (line === sym.endLine && character > sym.endColumn) continue;

        if (!best || (sym.endLine - sym.line) < (best.endLine - best.line)) {
            best = sym;
        }
    }
    return best;
}

function findInsertPosition(text: string, classSym: JavaSymbol): lsp.Position {
    // Insert before the closing brace of the class
    return lsp.Position.create(classSym.endLine, 0);
}

function createCodeAction(
    title: string,
    uri: string,
    position: lsp.Position,
    newText: string,
    kind: lsp.CodeActionKind,
): lsp.CodeAction {
    return {
        title,
        kind,
        edit: {
            changes: {
                [uri]: [lsp.TextEdit.insert(position, newText)],
            },
        },
    };
}
