/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { CstNode, IToken } from 'chevrotain';
import { isCstNode } from './cst-utils.js';

export interface ImportInfo {
    /** The simple name (e.g., "List") or "*" for wildcards */
    simpleName: string;
    /** The fully qualified name (e.g., "java.util.List") or package prefix for wildcards */
    qualifiedName: string;
    /** Whether this is a wildcard import (java.util.*) */
    isWildcard: boolean;
    /** Whether this is a static import */
    isStatic: boolean;
    /** The import's line number (0-based) */
    line: number;
}

export interface ImportMap {
    /** The package name of this file (e.g., "com.example") */
    packageName: string;
    /** Map from simple name to ImportInfo */
    imports: Map<string, ImportInfo>;
    /** Wildcard import packages (e.g., ["java.util", "java.io"]) */
    wildcardPackages: string[];
    /** Static imports (e.g., "PI" -> "java.lang.Math.PI") */
    staticImports: Map<string, ImportInfo>;
    /** Static wildcard packages (e.g., ["java.lang.Math"]) */
    staticWildcardClasses: string[];
}

/**
 * Java.lang types that are auto-imported.
 */
export const JAVA_LANG_TYPES: ReadonlySet<string> = new Set([
    // Core types
    'Object', 'String', 'Class', 'Enum', 'Record',
    // Boxed primitives
    'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Byte', 'Short', 'Character',
    // Numeric
    'Number', 'Math', 'StrictMath',
    // System / runtime
    'System', 'Runtime', 'RuntimePermission', 'Process', 'ProcessBuilder',
    'Thread', 'ThreadGroup', 'ThreadLocal', 'InheritableThreadLocal',
    // Functional / interfaces
    'Runnable', 'Iterable', 'Comparable', 'Cloneable', 'AutoCloseable',
    'Readable', 'Appendable', 'CharSequence',
    // String builders
    'StringBuilder', 'StringBuffer',
    // Throwables
    'Throwable', 'Exception', 'RuntimeException', 'Error',
    'ArithmeticException', 'ArrayIndexOutOfBoundsException', 'ArrayStoreException',
    'ClassCastException', 'ClassNotFoundException', 'CloneNotSupportedException',
    'IllegalAccessException', 'IllegalArgumentException', 'IllegalMonitorStateException',
    'IllegalStateException', 'IllegalThreadStateException', 'IndexOutOfBoundsException',
    'InstantiationException', 'InterruptedException', 'NegativeArraySizeException',
    'NoSuchFieldException', 'NoSuchMethodException', 'NullPointerException',
    'NumberFormatException', 'OutOfMemoryError', 'SecurityException',
    'StackOverflowError', 'StringIndexOutOfBoundsException',
    'UnsupportedOperationException',
    // Annotations
    'Override', 'Deprecated', 'SuppressWarnings', 'FunctionalInterface', 'SafeVarargs',
    // Void
    'Void',
    // Deprecated but still in java.lang
    'Compiler',
]);

const JAVA_PRIMITIVES: ReadonlySet<string> = new Set([
    'boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double', 'void',
]);

/**
 * Parse import declarations from a CST and build an ImportMap.
 */
export function buildImportMap(cst: CstNode): ImportMap {
    const result: ImportMap = {
        packageName: '',
        imports: new Map(),
        wildcardPackages: [],
        staticImports: new Map(),
        staticWildcardClasses: [],
    };

    const ocu = getChild(cst, 'ordinaryCompilationUnit');
    if (!ocu) return result;

    // Extract package name
    const pkgDecl = getChild(ocu, 'packageDeclaration');
    if (pkgDecl) {
        result.packageName = extractPackageOrTypeName(pkgDecl);
    }

    // Process import declarations
    const importDecls = ocu.children['importDeclaration'];
    if (!importDecls) return result;

    for (const decl of importDecls) {
        if (!isCstNode(decl)) continue;

        const identifiers = getIdentifiersFromImport(decl);
        if (identifiers.length === 0) continue;

        const isWildcard = !!(decl.children['Star'] as IToken[] | undefined)?.length;
        const isStatic = !!(decl.children['Static'] as IToken[] | undefined)?.length;
        const importToken = (decl.children['Import'] as IToken[] | undefined)?.[0];
        const line = importToken?.startLine != null ? importToken.startLine - 1 : 0;

        if (isWildcard) {
            const qualifiedName = identifiers.map(t => t.image).join('.');
            const info: ImportInfo = {
                simpleName: '*',
                qualifiedName,
                isWildcard: true,
                isStatic,
                line,
            };

            if (isStatic) {
                result.staticWildcardClasses.push(qualifiedName);
                result.staticImports.set('*:' + qualifiedName, info);
            } else {
                result.wildcardPackages.push(qualifiedName);
                result.imports.set('*:' + qualifiedName, info);
            }
        } else {
            const qualifiedName = identifiers.map(t => t.image).join('.');

            if (isStatic) {
                // For static imports: last identifier is the member, rest is the class
                const memberName = identifiers[identifiers.length - 1].image;
                const info: ImportInfo = {
                    simpleName: memberName,
                    qualifiedName,
                    isWildcard: false,
                    isStatic: true,
                    line,
                };
                result.staticImports.set(memberName, info);
            } else {
                const simpleName = identifiers[identifiers.length - 1].image;
                const info: ImportInfo = {
                    simpleName,
                    qualifiedName,
                    isWildcard: false,
                    isStatic: false,
                    line,
                };
                result.imports.set(simpleName, info);
            }
        }
    }

    return result;
}

/**
 * Resolve a simple type name to its qualified name using the import map.
 * Checks in order: 1) explicit imports, 2) same-package types, 3) java.lang.* types, 4) wildcard imports
 * Returns undefined if the name cannot be resolved.
 */
export function resolveTypeName(name: string, importMap: ImportMap): string | undefined {
    // Already qualified
    if (name.includes('.')) return name;

    // Primitives pass through as-is
    if (JAVA_PRIMITIVES.has(name)) return name;

    // 1) Explicit import
    const explicit = importMap.imports.get(name);
    if (explicit) return explicit.qualifiedName;

    // 2) java.lang auto-imports
    if (JAVA_LANG_TYPES.has(name)) return 'java.lang.' + name;

    // 3) Wildcard imports: best-guess if exactly one wildcard package
    if (importMap.wildcardPackages.length === 1) {
        return importMap.wildcardPackages[0] + '.' + name;
    }

    return undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getChild(node: CstNode, name: string): CstNode | undefined {
    const children = node.children[name];
    if (!children || children.length === 0) return undefined;
    const child = children[0];
    return isCstNode(child) ? child : undefined;
}

function extractPackageOrTypeName(node: CstNode): string {
    // java-parser may place Identifier tokens directly on packageDeclaration
    // or nested inside a packageOrTypeName child — handle both.
    const potn = getChild(node, 'packageOrTypeName');
    const tokens = (potn?.children['Identifier'] as IToken[] | undefined)
        ?? (node.children['Identifier'] as IToken[] | undefined);
    if (!tokens) return '';
    return tokens.map(t => t.image).join('.');
}

function getIdentifiersFromImport(decl: CstNode): IToken[] {
    const potn = getChild(decl, 'packageOrTypeName');
    if (!potn) return [];
    return (potn.children['Identifier'] as IToken[] | undefined) ?? [];
}
