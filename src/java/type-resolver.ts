/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { JavaSymbol, SymbolTable } from './symbol-table.js';
import type { WorkspaceIndex } from '../project/workspace-index.js';
import { getJdkType } from '../project/jdk-model.js';
import type { JdkType, JdkMethod, JdkField } from '../project/jdk-model.js';

// ── Public interfaces ──────────────────────────────────────────────

export interface ResolvedType {
    /** The simple name (e.g., "List") */
    simpleName: string;
    /** The fully qualified name if known (e.g., "java.util.List") */
    qualifiedName?: string;
    /** Type arguments for generics (e.g., ["String"] for List<String>) */
    typeArguments?: string[];
    /** Whether this is a primitive type */
    isPrimitive: boolean;
    /** Whether this is an array type */
    isArray: boolean;
    /** Array dimensions (e.g., 2 for int[][]) */
    arrayDimensions: number;
}

export interface TypeContext {
    /** Symbol table for the current file */
    symbolTable: SymbolTable;
    /** Workspace index for cross-file resolution */
    workspaceIndex?: WorkspaceIndex;
    /** Import map for the current file */
    importMap?: ImportMap;
}

export interface ImportMap {
    packageName: string;
    imports: Map<string, { qualifiedName: string }>;
    wildcardPackages: string[];
}

export interface MethodInfo {
    name: string;
    returnType: string;
    parameters: { name: string; type: string }[];
    isStatic: boolean;
    declaringType: string;
}

export interface FieldInfo {
    name: string;
    type: string;
    isStatic: boolean;
    declaringType: string;
}

// ── Constants ──────────────────────────────────────────────────────

const PRIMITIVE_TYPES = new Set([
    'byte', 'short', 'int', 'long', 'float', 'double', 'boolean', 'char', 'void',
]);

const TYPE_SYMBOL_KINDS = new Set(['class', 'interface', 'enum', 'record']);

// ── Public API ─────────────────────────────────────────────────────

/**
 * Resolve a type name string to a ResolvedType.
 * Handles primitives, arrays, generics, and qualified names.
 */
export function resolveTypeString(typeStr: string, context: TypeContext): ResolvedType {
    let remaining = typeStr.trim();

    // Count and strip array dimensions
    let arrayDimensions = 0;
    while (remaining.endsWith('[]')) {
        arrayDimensions++;
        remaining = remaining.slice(0, -2);
    }

    // Extract generic type arguments
    let typeArguments: string[] | undefined;
    const angleBracketStart = remaining.indexOf('<');
    if (angleBracketStart !== -1 && remaining.endsWith('>')) {
        const argsStr = remaining.slice(angleBracketStart + 1, -1);
        typeArguments = splitTopLevelTypeArgs(argsStr);
        remaining = remaining.slice(0, angleBracketStart);
    }

    remaining = remaining.trim();

    const isPrimitive = PRIMITIVE_TYPES.has(remaining);

    // Try to resolve qualified name
    let qualifiedName: string | undefined;
    if (remaining.includes('.')) {
        // Already qualified
        qualifiedName = remaining;
        remaining = remaining.slice(remaining.lastIndexOf('.') + 1);
    } else if (!isPrimitive) {
        qualifiedName = resolveQualifiedName(remaining, context);
    }

    return {
        simpleName: remaining,
        qualifiedName,
        typeArguments,
        isPrimitive,
        isArray: arrayDimensions > 0,
        arrayDimensions,
    };
}

/**
 * Resolve the type of a symbol (variable, field, parameter, method return).
 */
export function resolveSymbolType(symbol: JavaSymbol, context: TypeContext): ResolvedType | undefined {
    let typeStr: string | undefined;

    if (symbol.kind === 'method' || symbol.kind === 'constructor') {
        typeStr = symbol.returnType;
    } else {
        // field, variable, parameter, enumConstant
        typeStr = symbol.type;
    }

    if (!typeStr) return undefined;
    return resolveTypeString(typeStr, context);
}

/**
 * Find members (methods and fields) available on a given type.
 * Searches: workspace types → JDK model → superclass chain.
 */
export function findTypeMembers(
    typeName: string,
    context: TypeContext,
): { methods: MethodInfo[]; fields: FieldInfo[] } {
    const methods: MethodInfo[] = [];
    const fields: FieldInfo[] = [];
    const visited = new Set<string>();

    collectMembers(typeName, context, methods, fields, visited);

    return { methods: deduplicateMethods(methods), fields: deduplicateFields(fields) };
}

/**
 * Resolve the type of a method call expression.
 */
export function resolveMethodReturnType(
    typeName: string,
    methodName: string,
    context: TypeContext,
): ResolvedType | undefined {
    const { methods } = findTypeMembers(typeName, context);
    const match = methods.find(m => m.name === methodName);
    if (!match) return undefined;
    return resolveTypeString(match.returnType, context);
}

/**
 * Resolve the type of a field access.
 */
export function resolveFieldType(
    typeName: string,
    fieldName: string,
    context: TypeContext,
): ResolvedType | undefined {
    const { fields } = findTypeMembers(typeName, context);
    const match = fields.find(f => f.name === fieldName);
    if (!match) return undefined;
    return resolveTypeString(match.type, context);
}

// ── Internal helpers ───────────────────────────────────────────────

/**
 * Split top-level generic type arguments, respecting nested angle brackets.
 * E.g., "String, List<Integer>" → ["String", "List<Integer>"]
 */
function splitTopLevelTypeArgs(argsStr: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let current = '';

    for (const ch of argsStr) {
        if (ch === '<') {
            depth++;
            current += ch;
        } else if (ch === '>') {
            depth--;
            current += ch;
        } else if (ch === ',' && depth === 0) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }

    const last = current.trim();
    if (last) result.push(last);
    return result;
}

/**
 * Attempt to resolve a simple type name to its fully qualified name
 * using the import map and JDK model.
 */
function resolveQualifiedName(simpleName: string, context: TypeContext): string | undefined {
    // Check import map first
    if (context.importMap) {
        const entry = context.importMap.imports.get(simpleName);
        if (entry) return entry.qualifiedName;
    }

    // Check JDK types (java.lang types are auto-imported)
    const jdkType = getJdkType(simpleName);
    if (jdkType) return jdkType.qualifiedName;

    return undefined;
}

/**
 * Find a workspace type symbol by name, checking local symbol table first,
 * then the workspace index.
 */
function findWorkspaceType(typeName: string, context: TypeContext): JavaSymbol | undefined {
    // Check local symbol table
    for (const sym of context.symbolTable.allSymbols) {
        if (sym.name === typeName && TYPE_SYMBOL_KINDS.has(sym.kind)) {
            return sym;
        }
    }

    // Check workspace index
    if (context.workspaceIndex) {
        const entry = context.workspaceIndex.findTypeByName(typeName);
        if (entry) {
            const table = context.workspaceIndex.getSymbolTable(entry.uri);
            if (table) {
                return table.allSymbols.find(
                    s => s.name === typeName && TYPE_SYMBOL_KINDS.has(s.kind),
                );
            }
        }
    }

    return undefined;
}

/**
 * Recursively collect methods and fields from a type, walking the
 * workspace types, JDK model, and superclass chain.
 */
function collectMembers(
    typeName: string,
    context: TypeContext,
    methods: MethodInfo[],
    fields: FieldInfo[],
    visited: Set<string>,
): void {
    if (visited.has(typeName)) return;
    visited.add(typeName);

    // 1. Check workspace types
    const workspaceSym = findWorkspaceType(typeName, context);
    if (workspaceSym) {
        for (const child of workspaceSym.children) {
            if (child.kind === 'method') {
                methods.push({
                    name: child.name,
                    returnType: child.returnType ?? 'void',
                    parameters: child.parameters ?? [],
                    isStatic: child.modifiers.includes('static'),
                    declaringType: typeName,
                });
            } else if (child.kind === 'field') {
                fields.push({
                    name: child.name,
                    type: child.type ?? 'Object',
                    isStatic: child.modifiers.includes('static'),
                    declaringType: typeName,
                });
            }
        }

        // Walk workspace superclass
        if (workspaceSym.superclass) {
            collectMembers(workspaceSym.superclass, context, methods, fields, visited);
        }
        // Walk workspace interfaces
        if (workspaceSym.interfaces) {
            for (const iface of workspaceSym.interfaces) {
                collectMembers(iface, context, methods, fields, visited);
            }
        }
    }

    // 2. Check JDK model
    const jdkType = getJdkType(typeName);
    if (jdkType) {
        for (const m of jdkType.methods) {
            methods.push({
                name: m.name,
                returnType: m.returnType,
                parameters: m.parameters,
                isStatic: m.isStatic,
                declaringType: jdkType.name,
            });
        }
        for (const f of jdkType.fields) {
            fields.push({
                name: f.name,
                type: f.type,
                isStatic: f.isStatic,
                declaringType: jdkType.name,
            });
        }

        // Walk JDK superclass chain
        if (jdkType.superclass) {
            collectMembers(jdkType.superclass, context, methods, fields, visited);
        }
        if (jdkType.interfaces) {
            for (const iface of jdkType.interfaces) {
                // Strip generics from interface names like "Comparable<String>"
                const baseName = iface.includes('<') ? iface.slice(0, iface.indexOf('<')) : iface;
                collectMembers(baseName, context, methods, fields, visited);
            }
        }
    }
}

/**
 * Deduplicate methods by name + parameter count, keeping the first (most specific) declaration.
 */
function deduplicateMethods(methods: MethodInfo[]): MethodInfo[] {
    const seen = new Map<string, MethodInfo>();
    for (const m of methods) {
        const key = `${m.name}#${m.parameters.length}`;
        if (!seen.has(key)) {
            seen.set(key, m);
        }
    }
    return [...seen.values()];
}

/**
 * Deduplicate fields by name, keeping the first (most specific) declaration.
 */
function deduplicateFields(fields: FieldInfo[]): FieldInfo[] {
    const seen = new Map<string, FieldInfo>();
    for (const f of fields) {
        if (!seen.has(f.name)) {
            seen.set(f.name, f);
        }
    }
    return [...seen.values()];
}
