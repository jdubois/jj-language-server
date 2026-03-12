/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { CstNode, CstElement, IToken } from 'chevrotain';
import type { SymbolTable, JavaSymbol } from '../java/symbol-table.js';
import { isCstNode } from '../java/cst-utils.js';
import { getAutoImportedTypes, getJdkType } from '../project/jdk-model.js';

const JAVA_LANG_TYPES = new Set(getAutoImportedTypes().map(t => t.name));

const PRIMITIVE_TYPES = new Set([
    'boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double', 'void',
]);

const COMMON_ANNOTATIONS = new Set([
    'Override', 'Deprecated', 'SuppressWarnings', 'FunctionalInterface',
    'SafeVarargs', 'Nullable', 'NonNull', 'NotNull',
]);

export interface SemanticDiagnostic {
    range: lsp.Range;
    message: string;
    severity: lsp.DiagnosticSeverity;
    code?: string;
}

/**
 * Run all semantic checks and return diagnostics.
 */
export function computeSemanticDiagnostics(
    cst: CstNode,
    table: SymbolTable,
    text: string,
): lsp.Diagnostic[] {
    const diagnostics: lsp.Diagnostic[] = [];

    diagnostics.push(...checkUnresolvedTypes(cst, table, text));
    diagnostics.push(...checkDuplicateDeclarations(table));
    diagnostics.push(...checkUnusedImports(cst, text));
    diagnostics.push(...checkMissingReturn(cst, table));
    diagnostics.push(...checkUnreachableCode(cst));

    return diagnostics.map(d => ({ ...d, source: 'jj-language-server' }));
}

// --- Unresolved Type References ---

function checkUnresolvedTypes(cst: CstNode, table: SymbolTable, text: string): lsp.Diagnostic[] {
    const diagnostics: lsp.Diagnostic[] = [];
    const importedNames = extractImportedNames(text);
    const declaredTypes = new Set(table.allSymbols.filter(s =>
        ['class', 'interface', 'enum', 'record'].includes(s.kind),
    ).map(s => s.name));

    // Collect type reference tokens (identifiers starting with uppercase in type positions)
    const typeRefs = collectTypeReferenceTokens(cst);
    const reported = new Set<string>();

    for (const token of typeRefs) {
        const name = token.image;
        if (reported.has(name)) continue;
        if (PRIMITIVE_TYPES.has(name)) continue;
        if (JAVA_LANG_TYPES.has(name)) continue;
        if (COMMON_ANNOTATIONS.has(name)) continue;
        if (declaredTypes.has(name)) continue;
        if (importedNames.has(name)) continue;
        if (getJdkType(name)) continue;
        // Type parameters (single uppercase letters) are likely generics
        if (name.length === 1 && /^[A-Z]$/.test(name)) continue;

        reported.add(name);
        diagnostics.push(lsp.Diagnostic.create(
            tokenToRange(token),
            `Cannot resolve type '${name}'`,
            lsp.DiagnosticSeverity.Warning,
            'unresolved-type',
            'jj-language-server',
        ));
    }

    return diagnostics;
}

function collectTypeReferenceTokens(cst: CstNode): IToken[] {
    const tokens: IToken[] = [];
    collectTypeRefsRecursive(cst, tokens, false);
    return tokens;
}

function collectTypeRefsRecursive(node: CstNode, tokens: IToken[], inTypeContext: boolean): void {
    const name = node.name;
    const isTypeContext = inTypeContext ||
        name === 'unannType' ||
        name === 'classType' ||
        name === 'interfaceType' ||
        name === 'typeIdentifier' ||
        name === 'unannClassType' ||
        name === 'unannReferenceType' ||
        name === 'superclass' ||
        name === 'superinterfaces' ||
        name === 'extendsInterfaces' ||
        name === 'classOrInterfaceTypeToInstantiate';

    for (const [key, children] of Object.entries(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                collectTypeRefsRecursive(child, tokens, isTypeContext);
            } else {
                const token = child as IToken;
                if (isTypeContext && token.tokenType?.name === 'Identifier' && /^[A-Z]/.test(token.image)) {
                    tokens.push(token);
                }
            }
        }
    }
}

// --- Duplicate Declarations ---

function checkDuplicateDeclarations(table: SymbolTable): lsp.Diagnostic[] {
    const diagnostics: lsp.Diagnostic[] = [];

    for (const sym of table.symbols) {
        checkDuplicatesInScope(sym, diagnostics);
    }

    return diagnostics;
}

function checkDuplicatesInScope(parent: JavaSymbol, diagnostics: lsp.Diagnostic[]): void {
    const seen = new Map<string, JavaSymbol>();

    for (const child of parent.children) {
        // Methods can be overloaded — key by name + param type signature
        const key = child.kind === 'method'
            ? `method:${child.name}:${child.parameters?.map(p => p.type).join(',') ?? ''}`
            : `${child.kind}:${child.name}`;

        const existing = seen.get(key);
        if (existing) {
            diagnostics.push(lsp.Diagnostic.create(
                lsp.Range.create(child.line, child.column, child.endLine, child.endColumn),
                `Duplicate ${child.kind} '${child.name}' in '${parent.name}'`,
                lsp.DiagnosticSeverity.Error,
                'duplicate-declaration',
                'jj-language-server',
            ));
        } else {
            seen.set(key, child);
        }

        // Recurse into nested types
        if (['class', 'interface', 'enum', 'record'].includes(child.kind)) {
            checkDuplicatesInScope(child, diagnostics);
        }
    }
}

// --- Unused Imports ---

function checkUnusedImports(cst: CstNode, text: string): lsp.Diagnostic[] {
    const diagnostics: lsp.Diagnostic[] = [];
    const lines = text.split('\n');

    // Collect all identifiers used in code (not in import statements)
    const usedIdentifiers = new Set<string>();
    collectAllIdentifiers(cst, usedIdentifiers);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('import ')) continue;
        if (line.includes('*;')) continue; // Skip wildcard imports

        const isStatic = line.includes(' static ');
        const name = line
            .replace(/^import\s+/, '')
            .replace(/^static\s+/, '')
            .replace(/\s*;\s*$/, '')
            .trim();

        const simpleName = name.split('.').pop()!;

        // For static imports, check if the method/field name is used
        // For regular imports, check if the type name is used
        if (!usedIdentifiers.has(simpleName)) {
            const lineLen = lines[i].length;
            diagnostics.push(lsp.Diagnostic.create(
                lsp.Range.create(i, 0, i, lineLen),
                `Unused import '${name}'`,
                lsp.DiagnosticSeverity.Hint,
                'unused-import',
                'jj-language-server',
            ));
        }
    }

    return diagnostics;
}

function collectAllIdentifiers(node: CstNode, ids: Set<string>): void {
    // Skip import declarations
    if (node.name === 'importDeclaration') return;

    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                collectAllIdentifiers(child, ids);
            } else {
                const token = child as IToken;
                if (token.tokenType?.name === 'Identifier') {
                    ids.add(token.image);
                }
            }
        }
    }
}

// --- Missing Return Statements ---

function checkMissingReturn(cst: CstNode, table: SymbolTable): lsp.Diagnostic[] {
    const diagnostics: lsp.Diagnostic[] = [];

    for (const sym of table.allSymbols) {
        if (sym.kind !== 'method') continue;
        if (!sym.returnType || sym.returnType === 'void') continue;

        // Find the method body in the CST and check for return
        const hasReturn = methodBodyHasReturn(cst, sym);
        if (!hasReturn) {
            diagnostics.push(lsp.Diagnostic.create(
                lsp.Range.create(sym.line, sym.column, sym.line, sym.column + sym.name.length),
                `Method '${sym.name}' may be missing a return statement`,
                lsp.DiagnosticSeverity.Warning,
                'missing-return',
                'jj-language-server',
            ));
        }
    }

    return diagnostics;
}

function methodBodyHasReturn(cst: CstNode, sym: JavaSymbol): boolean {
    // Find method nodes that match this symbol's position
    const methodNode = findNodeAtPosition(cst, sym.line, sym.column, 'methodDeclaration');
    if (!methodNode) return true; // Can't verify, assume it's fine

    const body = findChildByName(methodNode, 'methodBody');
    if (!body) return true; // Abstract or interface method

    // Check if the body is just a semicolon (abstract)
    const block = findChildByName(body, 'block');
    if (!block) return true;

    return blockContainsReturn(block);
}

function blockContainsReturn(node: CstNode): boolean {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (!isCstNode(child)) {
                const token = child as IToken;
                if (token.tokenType?.name === 'Return') return true;
                if (token.tokenType?.name === 'Throw') return true;
            } else {
                if (blockContainsReturn(child)) return true;
            }
        }
    }
    return false;
}

// --- Unreachable Code ---

function checkUnreachableCode(cst: CstNode): lsp.Diagnostic[] {
    const diagnostics: lsp.Diagnostic[] = [];
    findUnreachableStatements(cst, diagnostics);
    return diagnostics;
}

function findUnreachableStatements(node: CstNode, diagnostics: lsp.Diagnostic[]): void {
    // Look for block statements that contain a return/throw/break/continue
    // followed by more statements
    if (node.name === 'block' || node.name === 'blockStatements') {
        const stmts = findChildrenByName(node, 'blockStatement');
        let foundTerminator = false;

        for (const stmt of stmts) {
            if (foundTerminator) {
                const pos = getFirstTokenPosition(stmt);
                if (pos) {
                    diagnostics.push(lsp.Diagnostic.create(
                        lsp.Range.create(pos.line, pos.column, pos.line, pos.column + 1),
                        'Unreachable code',
                        lsp.DiagnosticSeverity.Warning,
                        'unreachable-code',
                        'jj-language-server',
                    ));
                }
                break; // Only report first unreachable statement
            }

            if (isTerminatingStatement(stmt)) {
                foundTerminator = true;
            }
        }
    }

    // Recurse into child nodes
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                findUnreachableStatements(child, diagnostics);
            }
        }
    }
}

function isTerminatingStatement(node: CstNode): boolean {
    // Check if this statement is a return, throw, break, or continue
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (!isCstNode(child)) {
                const token = child as IToken;
                const name = token.tokenType?.name;
                if (name === 'Return' || name === 'Throw' || name === 'Break' || name === 'Continue') {
                    return true;
                }
            } else {
                // Check direct children like returnStatement, throwStatement
                const childName = child.name;
                if (childName === 'returnStatement' || childName === 'throwStatement' ||
                    childName === 'breakStatement' || childName === 'continueStatement') {
                    return true;
                }
                // Check within statement wrappers
                if (childName === 'statement' || childName === 'expressionStatement' ||
                    childName === 'statementWithoutTrailingSubstatement') {
                    if (isTerminatingStatement(child)) return true;
                }
            }
        }
    }
    return false;
}

// --- Shared Helpers ---

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

function tokenToRange(token: IToken): lsp.Range {
    return lsp.Range.create(
        (token.startLine ?? 1) - 1,
        (token.startColumn ?? 1) - 1,
        (token.endLine ?? 1) - 1,
        token.endColumn ?? 0,
    );
}

function findNodeAtPosition(node: CstNode, line: number, column: number, targetName: string): CstNode | undefined {
    if (node.name === targetName) {
        const pos = getFirstTokenPosition(node);
        if (pos && pos.line === line && pos.column === column) {
            return node;
        }
    }

    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                const found = findNodeAtPosition(child, line, column, targetName);
                if (found) return found;
            }
        }
    }

    return undefined;
}

function findChildByName(node: CstNode, name: string): CstNode | undefined {
    const children = node.children[name] as CstElement[] | undefined;
    if (!children || children.length === 0) return undefined;
    const child = children[0];
    return isCstNode(child) ? child : undefined;
}

function findChildrenByName(node: CstNode, name: string): CstNode[] {
    const children = node.children[name] as CstElement[] | undefined;
    if (!children) return [];
    return children.filter(isCstNode);
}

function getFirstTokenPosition(node: CstNode): { line: number; column: number } | undefined {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                const pos = getFirstTokenPosition(child);
                if (pos) return pos;
            } else {
                const token = child as IToken;
                return {
                    line: (token.startLine ?? 1) - 1,
                    column: (token.startColumn ?? 1) - 1,
                };
            }
        }
    }
    return undefined;
}
