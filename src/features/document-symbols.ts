/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { CstNode, CstElement, IToken } from 'chevrotain';
import { isCstNode, getStartPosition, getEndPosition } from '../java/cst-utils.js';

/**
 * Extract document symbols (outline) from a java-parser CST.
 */
export function extractDocumentSymbols(cst: CstNode): lsp.DocumentSymbol[] {
    const symbols: lsp.DocumentSymbol[] = [];
    const compilationUnit = getChild(cst, 'ordinaryCompilationUnit');
    if (!compilationUnit) return symbols;

    const packageDecl = getChild(compilationUnit, 'packageDeclaration');
    if (packageDecl) {
        const name = collectIdentifierChain(packageDecl);
        if (name) {
            symbols.push(createSymbol(name, lsp.SymbolKind.Package, packageDecl));
        }
    }

    const typeDecls = getChildren(compilationUnit, 'typeDeclaration');
    for (const typeDecl of typeDecls) {
        const sym = extractTypeDeclaration(typeDecl);
        if (sym) symbols.push(sym);
    }

    return symbols;
}

function extractTypeDeclaration(node: CstNode): lsp.DocumentSymbol | null {
    const classDecl = getChild(node, 'classDeclaration');
    if (classDecl) return extractClassDeclaration(classDecl);

    const interfaceDecl = getChild(node, 'interfaceDeclaration');
    if (interfaceDecl) return extractInterfaceDeclaration(interfaceDecl);

    return null;
}

function extractClassDeclaration(node: CstNode): lsp.DocumentSymbol | null {
    const normalClass = getChild(node, 'normalClassDeclaration');
    if (normalClass) {
        const name = getIdentifierName(normalClass);
        if (!name) return null;
        const symbol = createSymbol(name, lsp.SymbolKind.Class, normalClass);
        symbol.children = extractClassBodyMembers(normalClass);
        return symbol;
    }

    const enumDecl = getChild(node, 'enumDeclaration');
    if (enumDecl) return extractEnumDeclaration(enumDecl);

    const recordDecl = getChild(node, 'recordDeclaration');
    if (recordDecl) {
        const name = getIdentifierName(recordDecl);
        if (!name) return null;
        const symbol = createSymbol(name, lsp.SymbolKind.Struct, recordDecl);
        symbol.children = extractClassBodyMembers(recordDecl);
        return symbol;
    }

    return null;
}

function extractEnumDeclaration(node: CstNode): lsp.DocumentSymbol | null {
    const name = getIdentifierName(node);
    if (!name) return null;
    const symbol = createSymbol(name, lsp.SymbolKind.Enum, node);
    symbol.children = [];

    const enumBody = getChild(node, 'enumBody');
    if (enumBody) {
        const enumConstantList = getChild(enumBody, 'enumConstantList');
        if (enumConstantList) {
            const constants = getChildren(enumConstantList, 'enumConstant');
            for (const constant of constants) {
                const constName = getIdentifierName(constant);
                if (constName) {
                    symbol.children.push(createSymbol(constName, lsp.SymbolKind.EnumMember, constant));
                }
            }
        }

        const bodyDecls = getChild(enumBody, 'enumBodyDeclarations');
        if (bodyDecls) {
            const classBodyDecls = getChildren(bodyDecls, 'classBodyDeclaration');
            for (const decl of classBodyDecls) {
                const member = extractClassBodyDeclaration(decl);
                if (member) symbol.children.push(member);
            }
        }
    }

    return symbol;
}

function extractInterfaceDeclaration(node: CstNode): lsp.DocumentSymbol | null {
    const normalInterface = getChild(node, 'normalInterfaceDeclaration');
    if (normalInterface) {
        const name = getIdentifierName(normalInterface);
        if (!name) return null;
        const symbol = createSymbol(name, lsp.SymbolKind.Interface, normalInterface);
        symbol.children = [];

        const body = getChild(normalInterface, 'interfaceBody');
        if (body) {
            const memberDecls = getChildren(body, 'interfaceMemberDeclaration');
            for (const memberDecl of memberDecls) {
                const method = getChild(memberDecl, 'interfaceMethodDeclaration');
                if (method) {
                    const methodName = getMethodName(method);
                    if (methodName) {
                        symbol.children.push(createSymbol(methodName, lsp.SymbolKind.Method, method));
                    }
                }
                const constant = getChild(memberDecl, 'constantDeclaration');
                if (constant) {
                    const constName = getFieldName(constant);
                    if (constName) {
                        symbol.children.push(createSymbol(constName, lsp.SymbolKind.Constant, constant));
                    }
                }
                // Nested types
                const nestedClass = getChild(memberDecl, 'classDeclaration');
                if (nestedClass) {
                    const nested = extractClassDeclaration(nestedClass);
                    if (nested) symbol.children.push(nested);
                }
                const nestedInterface = getChild(memberDecl, 'interfaceDeclaration');
                if (nestedInterface) {
                    const nested = extractInterfaceDeclaration(nestedInterface);
                    if (nested) symbol.children.push(nested);
                }
            }
        }
        return symbol;
    }

    const annotationType = getChild(node, 'annotationInterfaceDeclaration');
    if (annotationType) {
        const name = getIdentifierName(annotationType);
        if (!name) return null;
        return createSymbol(name, lsp.SymbolKind.Interface, annotationType);
    }

    return null;
}

function extractClassBodyMembers(classNode: CstNode): lsp.DocumentSymbol[] {
    const members: lsp.DocumentSymbol[] = [];
    const classBody = getChild(classNode, 'classBody');
    if (!classBody) return members;

    const bodyDecls = getChildren(classBody, 'classBodyDeclaration');
    for (const decl of bodyDecls) {
        const member = extractClassBodyDeclaration(decl);
        if (member) members.push(member);
    }
    return members;
}

function extractClassBodyDeclaration(node: CstNode): lsp.DocumentSymbol | null {
    // Constructor
    const constructor = getChild(node, 'constructorDeclaration');
    if (constructor) {
        const name = getConstructorName(constructor);
        if (name) return createSymbol(name, lsp.SymbolKind.Constructor, constructor);
    }

    // Class member (method, field, nested type)
    const classMember = getChild(node, 'classMemberDeclaration');
    if (classMember) {
        const method = getChild(classMember, 'methodDeclaration');
        if (method) {
            const name = getMethodName(method);
            if (name) return createSymbol(name, lsp.SymbolKind.Method, method);
        }

        const field = getChild(classMember, 'fieldDeclaration');
        if (field) {
            const name = getFieldName(field);
            if (name) return createSymbol(name, lsp.SymbolKind.Field, field);
        }

        // Nested class
        const nestedClass = getChild(classMember, 'classDeclaration');
        if (nestedClass) return extractClassDeclaration(nestedClass);

        // Nested interface
        const nestedInterface = getChild(classMember, 'interfaceDeclaration');
        if (nestedInterface) return extractInterfaceDeclaration(nestedInterface);
    }

    // Static initializer
    const staticInit = getChild(node, 'staticInitializer');
    if (staticInit) {
        return createSymbol('<static initializer>', lsp.SymbolKind.Function, staticInit);
    }

    // Instance initializer
    const instanceInit = getChild(node, 'instanceInitializer');
    if (instanceInit) {
        return createSymbol('<instance initializer>', lsp.SymbolKind.Function, instanceInit);
    }

    return null;
}

// --- Name extraction helpers ---

function getIdentifierName(node: CstNode): string | undefined {
    // Try typeIdentifier first (for class/interface/enum)
    const typeId = getChild(node, 'typeIdentifier');
    if (typeId) {
        const tokens = typeId.children['Identifier'] as IToken[] | undefined;
        return tokens?.[0]?.image;
    }
    // Direct Identifier token
    const tokens = node.children['Identifier'] as IToken[] | undefined;
    return tokens?.[0]?.image;
}

function getMethodName(method: CstNode): string | undefined {
    const header = getChild(method, 'methodHeader');
    if (!header) return undefined;
    const declarator = getChild(header, 'methodDeclarator');
    if (!declarator) return undefined;
    const tokens = declarator.children['Identifier'] as IToken[] | undefined;
    return tokens?.[0]?.image;
}

function getConstructorName(constructor: CstNode): string | undefined {
    const declarator = getChild(constructor, 'constructorDeclarator');
    if (!declarator) return undefined;
    const simpleTypeName = getChild(declarator, 'simpleTypeName');
    if (simpleTypeName) {
        const typeId = getChild(simpleTypeName, 'typeIdentifier');
        if (typeId) {
            const tokens = typeId.children['Identifier'] as IToken[] | undefined;
            if (tokens?.[0]) return tokens[0].image;
        }
        const tokens = simpleTypeName.children['Identifier'] as IToken[] | undefined;
        return tokens?.[0]?.image;
    }
    const tokens = declarator.children['Identifier'] as IToken[] | undefined;
    return tokens?.[0]?.image;
}

function getFieldName(field: CstNode): string | undefined {
    const varDeclList = getChild(field, 'variableDeclaratorList');
    if (!varDeclList) return undefined;
    const varDecl = getChild(varDeclList, 'variableDeclarator');
    if (!varDecl) return undefined;
    const varDeclId = getChild(varDecl, 'variableDeclaratorId');
    if (!varDeclId) return undefined;
    const tokens = varDeclId.children['Identifier'] as IToken[] | undefined;
    return tokens?.[0]?.image;
}

function collectIdentifierChain(node: CstNode): string | undefined {
    const allTokens: IToken[] = [];
    collectIdentifierTokens(node, allTokens);
    if (allTokens.length === 0) return undefined;
    allTokens.sort((a, b) => a.startOffset - b.startOffset);
    return allTokens
        .filter(t => t.tokenType?.name === 'Identifier' || t.tokenType?.name === 'Dot')
        .map(t => t.image)
        .join('');
}

function collectIdentifierTokens(node: CstNode, tokens: IToken[]): void {
    for (const [key, children] of Object.entries(node.children)) {
        if (!children) continue;
        for (const child of children) {
            if (isCstNode(child)) {
                if (key === 'packageName' || key === 'Identifier') {
                    collectIdentifierTokens(child, tokens);
                }
            } else {
                const token = child as IToken;
                if (token.tokenType?.name === 'Identifier' || token.tokenType?.name === 'Dot') {
                    tokens.push(token);
                }
            }
        }
    }
    // Also get direct Identifier and Dot tokens
    const ids = node.children['Identifier'] as IToken[] | undefined;
    if (ids) tokens.push(...ids);
    const dots = node.children['Dot'] as IToken[] | undefined;
    if (dots) tokens.push(...dots);
}

// --- CST navigation helpers ---

function getChild(node: CstNode, name: string): CstNode | undefined {
    const children = node.children[name] as CstElement[] | undefined;
    if (!children || children.length === 0) return undefined;
    const child = children[0];
    return isCstNode(child) ? child : undefined;
}

function getChildren(node: CstNode, name: string): CstNode[] {
    const children = node.children[name] as CstElement[] | undefined;
    if (!children) return [];
    return children.filter(isCstNode);
}

// --- Symbol creation ---

function createSymbol(name: string, kind: lsp.SymbolKind, node: CstNode): lsp.DocumentSymbol {
    const start = getStartPosition(node);
    const end = getEndPosition(node);

    const range = lsp.Range.create(
        start.line - 1, start.column - 1,
        end.line - 1, end.column - 1,
    );

    return {
        name,
        kind,
        range,
        selectionRange: range,
        children: [],
    };
}
