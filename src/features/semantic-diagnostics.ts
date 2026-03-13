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
    diagnostics.push(...checkAccessControlViolations(table, text));
    diagnostics.push(...checkDeprecatedUsage(table, cst, text));
    diagnostics.push(...checkUnresolvedReferences(table, text));
    diagnostics.push(...checkMissingOverrideAnnotation(table, text));

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

    for (const [, children] of Object.entries(node.children)) {
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

// --- Access Control Violations ---

function checkAccessControlViolations(table: SymbolTable, text: string): lsp.Diagnostic[] {
    const diagnostics: lsp.Diagnostic[] = [];

    // Build map of className → {memberName → visibility info}
    const classMemberMap = new Map<string, Map<string, { modifiers: string[]; kind: string }>>();
    for (const sym of table.symbols) {
        if (!['class', 'interface', 'enum', 'record'].includes(sym.kind)) continue;
        const memberMap = new Map<string, { modifiers: string[]; kind: string }>();
        for (const child of sym.children) {
            if (child.kind === 'field' || child.kind === 'method') {
                memberMap.set(child.name, { modifiers: child.modifiers, kind: child.kind });
            }
        }
        classMemberMap.set(sym.name, memberMap);
    }

    const lines = text.split('\n');
    const dotAccessRegex = /\b([a-z][a-zA-Z0-9]*)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        let match;
        dotAccessRegex.lastIndex = 0;
        while ((match = dotAccessRegex.exec(line)) !== null) {
            const varName = match[1];
            const memberName = match[2];
            if (varName === 'this' || varName === 'super') continue;

            const enclosingClass = findEnclosingClassAtLine(table, lineIdx);
            if (!enclosingClass) continue;

            for (const [className, members] of classMemberMap) {
                if (className === enclosingClass) continue;
                const memberInfo = members.get(memberName);
                if (!memberInfo) continue;

                const memberCol = match.index + match[0].length - match[2].length;

                if (memberInfo.modifiers.includes('private')) {
                    diagnostics.push(lsp.Diagnostic.create(
                        lsp.Range.create(lineIdx, memberCol, lineIdx, memberCol + memberName.length),
                        `Cannot access private member '${memberName}' of class '${className}'`,
                        lsp.DiagnosticSeverity.Error,
                        'access-control',
                        'jj-language-server',
                    ));
                } else if (memberInfo.modifiers.includes('protected')) {
                    const enclosingSym = table.allSymbols.find(s =>
                        s.name === enclosingClass && ['class', 'interface', 'enum', 'record'].includes(s.kind));
                    const isSubclass = enclosingSym?.superclass === className;
                    if (!isSubclass) {
                        diagnostics.push(lsp.Diagnostic.create(
                            lsp.Range.create(lineIdx, memberCol, lineIdx, memberCol + memberName.length),
                            `Cannot access protected member '${memberName}' of class '${className}'`,
                            lsp.DiagnosticSeverity.Error,
                            'access-control',
                            'jj-language-server',
                        ));
                    }
                }
            }
        }
    }

    return diagnostics;
}

function findEnclosingClassAtLine(table: SymbolTable, line: number): string | undefined {
    for (const sym of table.symbols) {
        if (!['class', 'interface', 'enum', 'record'].includes(sym.kind)) continue;
        if (line >= sym.line && line <= sym.endLine) {
            // Check nested classes first
            for (const child of sym.children) {
                if (['class', 'interface', 'enum', 'record'].includes(child.kind)) {
                    if (line >= child.line && line <= child.endLine) {
                        return child.name;
                    }
                }
            }
            return sym.name;
        }
    }
    return undefined;
}

// --- Deprecated API Warning ---

function checkDeprecatedUsage(table: SymbolTable, cst: CstNode, text: string): lsp.Diagnostic[] {
    const diagnostics: lsp.Diagnostic[] = [];
    const lines = text.split('\n');

    // Find deprecated symbols by scanning for @Deprecated before declarations
    const deprecatedSymbols: JavaSymbol[] = [];
    const deprecatedNames = new Set<string>();

    for (const sym of table.allSymbols) {
        if (!['method', 'field', 'class', 'interface', 'enum', 'record'].includes(sym.kind)) continue;
        for (let i = Math.max(0, sym.line - 5); i <= sym.line; i++) {
            if (lines[i]?.includes('@Deprecated')) {
                deprecatedSymbols.push(sym);
                deprecatedNames.add(sym.name);
                break;
            }
        }
    }

    if (deprecatedNames.size === 0) return diagnostics;

    // Collect all identifier tokens (excluding imports)
    const tokens = collectIdentifierTokens(cst);
    const reported = new Set<string>();

    for (const token of tokens) {
        if (!deprecatedNames.has(token.image)) continue;

        const tokenLine = (token.startLine ?? 1) - 1;
        const tokenCol = (token.startColumn ?? 1) - 1;

        // Skip the declaration itself
        const isDecl = deprecatedSymbols.some(s => s.line === tokenLine && s.column === tokenCol);
        if (isDecl) continue;

        // Skip tokens on lines containing @Deprecated (the annotation itself)
        if (lines[tokenLine]?.includes('@Deprecated')) continue;

        const key = `${token.image}:${tokenLine}:${tokenCol}`;
        if (reported.has(key)) continue;
        reported.add(key);

        diagnostics.push({
            range: tokenToRange(token),
            message: `'${token.image}' is deprecated`,
            severity: lsp.DiagnosticSeverity.Warning,
            code: 'deprecated-usage',
            source: 'jj-language-server',
            tags: [lsp.DiagnosticTag.Deprecated],
        });
    }

    return diagnostics;
}

function collectIdentifierTokens(node: CstNode): IToken[] {
    const tokens: IToken[] = [];
    collectIdentifierTokensRecursive(node, tokens);
    return tokens;
}

function collectIdentifierTokensRecursive(node: CstNode, tokens: IToken[]): void {
    if (node.name === 'importDeclaration') return;

    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                collectIdentifierTokensRecursive(child, tokens);
            } else {
                const token = child as IToken;
                if (token.tokenType?.name === 'Identifier') {
                    tokens.push(token);
                }
            }
        }
    }
}

// --- Unresolved Method/Field References (this.xxx) ---

function checkUnresolvedReferences(table: SymbolTable, text: string): lsp.Diagnostic[] {
    const diagnostics: lsp.Diagnostic[] = [];
    const lines = text.split('\n');
    const thisCallRegex = /\bthis\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        let match;
        thisCallRegex.lastIndex = 0;
        while ((match = thisCallRegex.exec(line)) !== null) {
            const methodName = match[1];

            const enclosingClassName = findEnclosingClassAtLine(table, lineIdx);
            if (!enclosingClassName) continue;

            const classSym = table.allSymbols.find(s =>
                s.name === enclosingClassName && ['class', 'interface', 'enum', 'record'].includes(s.kind));
            if (!classSym) continue;

            // Check direct members
            let found = classSym.children.some(c =>
                c.name === methodName && (c.kind === 'method' || c.kind === 'constructor'));

            // Check inherited methods from superclass in the same file
            if (!found && classSym.superclass) {
                const superSym = table.allSymbols.find(s =>
                    s.name === classSym.superclass && ['class', 'interface'].includes(s.kind));
                if (superSym) {
                    found = superSym.children.some(c => c.name === methodName && c.kind === 'method');
                } else {
                    // Superclass is not in this file — assume the method exists
                    // to avoid false positives (we can't verify without cross-file resolution)
                    found = true;
                }
            }

            if (!found) {
                const methodCol = match.index + match[0].indexOf(methodName);
                diagnostics.push(lsp.Diagnostic.create(
                    lsp.Range.create(lineIdx, methodCol, lineIdx, methodCol + methodName.length),
                    `Cannot resolve method '${methodName}'`,
                    lsp.DiagnosticSeverity.Error,
                    'unresolved-method',
                    'jj-language-server',
                ));
            }
        }
    }

    return diagnostics;
}

// --- Missing Override Annotation ---

function checkMissingOverrideAnnotation(table: SymbolTable, text: string): lsp.Diagnostic[] {
    const diagnostics: lsp.Diagnostic[] = [];
    const lines = text.split('\n');

    // Build map of className → methods with param counts
    const classMethodMap = new Map<string, { name: string; paramCount: number }[]>();
    for (const sym of table.symbols) {
        if (sym.kind !== 'class') continue;
        classMethodMap.set(sym.name, sym.children
            .filter(c => c.kind === 'method')
            .map(m => ({ name: m.name, paramCount: m.parameters?.length ?? 0 })));
    }

    for (const sym of table.symbols) {
        if (sym.kind !== 'class' || !sym.superclass) continue;
        const superMethods = classMethodMap.get(sym.superclass);
        if (!superMethods) continue;

        for (const child of sym.children) {
            if (child.kind !== 'method') continue;
            const paramCount = child.parameters?.length ?? 0;
            const matchesSuper = superMethods.some(m =>
                m.name === child.name && m.paramCount === paramCount);
            if (!matchesSuper) continue;

            // Check if @Override is present before this method
            let hasOverride = false;
            for (let i = Math.max(0, child.line - 5); i <= child.line; i++) {
                if (lines[i]?.includes('@Override')) {
                    hasOverride = true;
                    break;
                }
            }

            if (!hasOverride) {
                diagnostics.push(lsp.Diagnostic.create(
                    lsp.Range.create(child.line, child.column, child.line, child.column + child.name.length),
                    `Method '${child.name}' overrides a method in '${sym.superclass}' but is not annotated with @Override`,
                    lsp.DiagnosticSeverity.Hint,
                    'missing-override',
                    'jj-language-server',
                ));
            }
        }
    }

    return diagnostics;
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
