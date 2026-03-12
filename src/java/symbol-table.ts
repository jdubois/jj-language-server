/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { CstNode, CstElement, IToken } from 'chevrotain';
import { isCstNode } from './cst-utils.js';

export type SymbolKind = 'class' | 'interface' | 'enum' | 'record' | 'method' | 'constructor' | 'field' | 'variable' | 'parameter' | 'enumConstant' | 'annotation';

export interface JavaSymbol {
    name: string;
    kind: SymbolKind;
    type?: string;
    modifiers: string[];
    /** 0-based line */
    line: number;
    /** 0-based column */
    column: number;
    endLine: number;
    endColumn: number;
    /** Parameters for methods/constructors: [{type, name}] */
    parameters?: { type: string; name: string }[];
    /** Return type for methods */
    returnType?: string;
    /** Parent symbol name (e.g., class name for a method) */
    parent?: string;
    /** Children symbols (members of a class/interface) */
    children: JavaSymbol[];
}

export interface SymbolTable {
    symbols: JavaSymbol[];
    /** Flat list for quick lookup */
    allSymbols: JavaSymbol[];
}

/**
 * Build a symbol table from a java-parser CST.
 */
export function buildSymbolTable(cst: CstNode): SymbolTable {
    const symbols: JavaSymbol[] = [];
    const allSymbols: JavaSymbol[] = [];

    const compilationUnit = getChild(cst, 'ordinaryCompilationUnit');
    if (!compilationUnit) return { symbols, allSymbols };

    const typeDecls = getChildren(compilationUnit, 'typeDeclaration');
    for (const typeDecl of typeDecls) {
        const sym = extractTypeSymbol(typeDecl, undefined);
        if (sym) {
            symbols.push(sym);
            flattenSymbols(sym, allSymbols);
        }
    }

    return { symbols, allSymbols };
}

function flattenSymbols(sym: JavaSymbol, flat: JavaSymbol[]): void {
    flat.push(sym);
    for (const child of sym.children) {
        flattenSymbols(child, flat);
    }
}

function extractTypeSymbol(node: CstNode, parent: string | undefined): JavaSymbol | null {
    const classDecl = getChild(node, 'classDeclaration');
    if (classDecl) return extractClassSymbol(classDecl, parent);

    const interfaceDecl = getChild(node, 'interfaceDeclaration');
    if (interfaceDecl) return extractInterfaceSymbol(interfaceDecl, parent);

    return null;
}

function extractClassSymbol(node: CstNode, parent: string | undefined): JavaSymbol | null {
    const modifiers = extractModifiers(node, 'classModifier');

    const normalClass = getChild(node, 'normalClassDeclaration');
    if (normalClass) {
        const name = getIdName(normalClass);
        if (!name) return null;
        const pos = getNodePosition(normalClass);
        const sym: JavaSymbol = {
            name, kind: 'class', modifiers, parent,
            ...pos, children: [],
        };
        extractClassBodySymbols(normalClass, sym);
        return sym;
    }

    const enumDecl = getChild(node, 'enumDeclaration');
    if (enumDecl) {
        const name = getIdName(enumDecl);
        if (!name) return null;
        const pos = getNodePosition(enumDecl);
        const sym: JavaSymbol = {
            name, kind: 'enum', modifiers, parent,
            ...pos, children: [],
        };
        extractEnumBodySymbols(enumDecl, sym);
        return sym;
    }

    const recordDecl = getChild(node, 'recordDeclaration');
    if (recordDecl) {
        const name = getIdName(recordDecl);
        if (!name) return null;
        const pos = getNodePosition(recordDecl);
        const sym: JavaSymbol = {
            name, kind: 'record', modifiers, parent,
            ...pos, children: [],
        };
        extractClassBodySymbols(recordDecl, sym);
        return sym;
    }

    return null;
}

function extractInterfaceSymbol(node: CstNode, parent: string | undefined): JavaSymbol | null {
    const modifiers = extractModifiers(node, 'interfaceModifier');

    const normalInterface = getChild(node, 'normalInterfaceDeclaration');
    if (normalInterface) {
        const name = getIdName(normalInterface);
        if (!name) return null;
        const pos = getNodePosition(normalInterface);
        const sym: JavaSymbol = {
            name, kind: 'interface', modifiers, parent,
            ...pos, children: [],
        };
        const body = getChild(normalInterface, 'interfaceBody');
        if (body) {
            const memberDecls = getChildren(body, 'interfaceMemberDeclaration');
            for (const memberDecl of memberDecls) {
                const method = getChild(memberDecl, 'interfaceMethodDeclaration');
                if (method) {
                    const methodSym = extractMethodSymbol(method, 'interfaceMethodModifier', name);
                    if (methodSym) sym.children.push(methodSym);
                }
                const nestedClass = getChild(memberDecl, 'classDeclaration');
                if (nestedClass) {
                    const nested = extractClassSymbol(nestedClass, name);
                    if (nested) sym.children.push(nested);
                }
                const nestedInterface = getChild(memberDecl, 'interfaceDeclaration');
                if (nestedInterface) {
                    const nested = extractInterfaceSymbol(nestedInterface, name);
                    if (nested) sym.children.push(nested);
                }
            }
        }
        return sym;
    }

    return null;
}

function extractClassBodySymbols(classNode: CstNode, sym: JavaSymbol): void {
    const classBody = getChild(classNode, 'classBody');
    if (!classBody) return;

    const bodyDecls = getChildren(classBody, 'classBodyDeclaration');
    for (const decl of bodyDecls) {
        // Constructor
        const constructor = getChild(decl, 'constructorDeclaration');
        if (constructor) {
            const cSym = extractConstructorSymbol(constructor, sym.name);
            if (cSym) sym.children.push(cSym);
            continue;
        }

        // Class member
        const classMember = getChild(decl, 'classMemberDeclaration');
        if (!classMember) continue;

        const method = getChild(classMember, 'methodDeclaration');
        if (method) {
            const mSym = extractMethodSymbol(method, 'methodModifier', sym.name);
            if (mSym) sym.children.push(mSym);
            continue;
        }

        const field = getChild(classMember, 'fieldDeclaration');
        if (field) {
            const fSym = extractFieldSymbol(field, sym.name);
            if (fSym) sym.children.push(fSym);
            continue;
        }

        // Nested types
        const nestedClass = getChild(classMember, 'classDeclaration');
        if (nestedClass) {
            const nested = extractClassSymbol(nestedClass, sym.name);
            if (nested) sym.children.push(nested);
            continue;
        }

        const nestedInterface = getChild(classMember, 'interfaceDeclaration');
        if (nestedInterface) {
            const nested = extractInterfaceSymbol(nestedInterface, sym.name);
            if (nested) sym.children.push(nested);
        }
    }
}

function extractEnumBodySymbols(enumNode: CstNode, sym: JavaSymbol): void {
    const enumBody = getChild(enumNode, 'enumBody');
    if (!enumBody) return;

    const enumConstantList = getChild(enumBody, 'enumConstantList');
    if (enumConstantList) {
        const constants = getChildren(enumConstantList, 'enumConstant');
        for (const constant of constants) {
            const name = getDirectIdentifier(constant);
            if (name) {
                const pos = getNodePosition(constant);
                sym.children.push({
                    name, kind: 'enumConstant', modifiers: ['public', 'static', 'final'],
                    parent: sym.name, ...pos, children: [],
                });
            }
        }
    }

    const bodyDecls = getChild(enumBody, 'enumBodyDeclarations');
    if (bodyDecls) {
        const classBodyDecls = getChildren(bodyDecls, 'classBodyDeclaration');
        for (const decl of classBodyDecls) {
            const classMember = getChild(decl, 'classMemberDeclaration');
            if (!classMember) continue;

            const method = getChild(classMember, 'methodDeclaration');
            if (method) {
                const mSym = extractMethodSymbol(method, 'methodModifier', sym.name);
                if (mSym) sym.children.push(mSym);
            }

            const field = getChild(classMember, 'fieldDeclaration');
            if (field) {
                const fSym = extractFieldSymbol(field, sym.name);
                if (fSym) sym.children.push(fSym);
            }
        }
    }
}

function extractMethodSymbol(method: CstNode, modifierKey: string, parent: string): JavaSymbol | null {
    const modifiers = extractModifiers(method, modifierKey);
    const header = getChild(method, 'methodHeader') ?? getChild(method, 'interfaceMethodModifier');
    if (!header && modifierKey !== 'interfaceMethodModifier') return null;

    const actualHeader = getChild(method, 'methodHeader');
    if (!actualHeader) return null;

    const declarator = getChild(actualHeader, 'methodDeclarator');
    if (!declarator) return null;

    const name = getDirectIdentifier(declarator);
    if (!name) return null;

    const returnType = extractTypeText(actualHeader, 'result') ?? extractUnannTypeText(actualHeader);
    const parameters = extractParameters(declarator);

    const pos = getNodePosition(method);
    const sym: JavaSymbol = {
        name, kind: 'method', modifiers, parent,
        returnType: returnType ?? 'void',
        parameters,
        ...pos, children: [],
    };

    // Extract local variables from method body
    const body = getChild(method, 'methodBody');
    if (body) {
        extractLocalVariables(body, sym);
    }

    return sym;
}

function extractConstructorSymbol(constructor: CstNode, parent: string): JavaSymbol | null {
    const modifiers = extractModifiers(constructor, 'constructorModifier');
    const declarator = getChild(constructor, 'constructorDeclarator');
    if (!declarator) return null;

    let name: string | undefined;
    const simpleTypeName = getChild(declarator, 'simpleTypeName');
    if (simpleTypeName) {
        const typeId = getChild(simpleTypeName, 'typeIdentifier');
        if (typeId) {
            name = getDirectIdentifier(typeId);
        }
        if (!name) name = getDirectIdentifier(simpleTypeName);
    }
    if (!name) name = getDirectIdentifier(declarator);
    if (!name) return null;

    const parameters = extractParameters(declarator);
    const pos = getNodePosition(constructor);

    const sym: JavaSymbol = {
        name, kind: 'constructor', modifiers, parent,
        parameters,
        ...pos, children: [],
    };

    const body = getChild(constructor, 'constructorBody');
    if (body) {
        extractLocalVariables(body, sym);
    }

    return sym;
}

function extractFieldSymbol(field: CstNode, parent: string): JavaSymbol | null {
    const modifiers = extractModifiers(field, 'fieldModifier');
    const type = extractUnannTypeText(field);
    const varDeclList = getChild(field, 'variableDeclaratorList');
    if (!varDeclList) return null;
    const varDecl = getChild(varDeclList, 'variableDeclarator');
    if (!varDecl) return null;
    const varDeclId = getChild(varDecl, 'variableDeclaratorId');
    if (!varDeclId) return null;
    const name = getDirectIdentifier(varDeclId);
    if (!name) return null;

    const pos = getNodePosition(field);
    return {
        name, kind: 'field', modifiers, parent, type,
        ...pos, children: [],
    };
}

function extractLocalVariables(body: CstNode, parentSym: JavaSymbol): void {
    visitNode(body, (node) => {
        const localVarDecl = getChild(node, 'localVariableDeclarationStatement');
        if (!localVarDecl) return;

        const localVar = getChild(localVarDecl, 'localVariableDeclaration');
        if (!localVar) return;

        const type = extractUnannTypeText(localVar) ?? extractLocalVarType(localVar);
        const varDeclList = getChild(localVar, 'variableDeclaratorList');
        if (!varDeclList) return;

        const varDecls = getChildren(varDeclList, 'variableDeclarator');
        for (const varDecl of varDecls) {
            const varDeclId = getChild(varDecl, 'variableDeclaratorId');
            if (!varDeclId) continue;
            const name = getDirectIdentifier(varDeclId);
            if (!name) continue;

            const pos = getNodePosition(varDecl);
            parentSym.children.push({
                name, kind: 'variable', modifiers: [], type,
                parent: parentSym.name,
                ...pos, children: [],
            });
        }
    });
}

function extractLocalVarType(node: CstNode): string | undefined {
    const varToken = node.children['Var'] as IToken[] | undefined;
    if (varToken?.[0]) return 'var';
    return undefined;
}

function extractParameters(declarator: CstNode): { type: string; name: string }[] {
    const params: { type: string; name: string }[] = [];
    const formalParamList = getChild(declarator, 'formalParameterList');
    if (!formalParamList) return params;

    const formalParams = getChildren(formalParamList, 'formalParameter');
    for (const fp of formalParams) {
        // Parameters can be wrapped in variableParaRegularParameter
        const regularParam = getChild(fp, 'variableParaRegularParameter') ?? fp;

        const type = extractUnannTypeText(regularParam) ?? 'Object';
        const varDeclId = getChild(regularParam, 'variableDeclaratorId');
        const name = varDeclId ? getDirectIdentifier(varDeclId) : undefined;
        if (name) {
            params.push({ type, name });
        }
    }

    return params;
}

// --- Type text extraction ---

function extractTypeText(node: CstNode, key: string): string | undefined {
    const resultNode = getChild(node, key);
    if (!resultNode) return undefined;
    return collectText(resultNode);
}

function extractUnannTypeText(node: CstNode): string | undefined {
    const unannType = getChild(node, 'unannType');
    if (!unannType) return undefined;
    return collectText(unannType);
}

function collectText(node: CstNode): string {
    const tokens: IToken[] = [];
    collectAllTokens(node, tokens);
    tokens.sort((a, b) => a.startOffset - b.startOffset);
    return tokens.map(t => t.image).join('');
}

function collectAllTokens(node: CstNode, tokens: IToken[]): void {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                collectAllTokens(child, tokens);
            } else {
                tokens.push(child as IToken);
            }
        }
    }
}

// --- Modifier extraction ---

function extractModifiers(node: CstNode, key: string): string[] {
    const modifiers: string[] = [];
    const modNodes = getChildren(node, key);
    for (const modNode of modNodes) {
        const text = collectText(modNode);
        // Filter out annotations
        if (text && !text.startsWith('@')) {
            modifiers.push(text);
        }
    }
    return modifiers;
}

// --- CST helpers ---

function getIdName(node: CstNode): string | undefined {
    const typeId = getChild(node, 'typeIdentifier');
    if (typeId) {
        const tokens = typeId.children['Identifier'] as IToken[] | undefined;
        return tokens?.[0]?.image;
    }
    return getDirectIdentifier(node);
}

function getDirectIdentifier(node: CstNode): string | undefined {
    const tokens = node.children['Identifier'] as IToken[] | undefined;
    return tokens?.[0]?.image;
}

function getNodePosition(node: CstNode): { line: number; column: number; endLine: number; endColumn: number } {
    const firstToken = findFirstTokenInNode(node);
    const lastToken = findLastTokenInNode(node);
    return {
        line: (firstToken?.startLine ?? 1) - 1,
        column: (firstToken?.startColumn ?? 1) - 1,
        endLine: (lastToken?.endLine ?? 1) - 1,
        endColumn: (lastToken?.endColumn ?? 0),
    };
}

function findFirstTokenInNode(node: CstNode): IToken | undefined {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                const found = findFirstTokenInNode(child);
                if (found) return found;
            } else {
                return child as IToken;
            }
        }
    }
    return undefined;
}

function findLastTokenInNode(node: CstNode): IToken | undefined {
    const keys = Object.keys(node.children);
    for (let i = keys.length - 1; i >= 0; i--) {
        const children = node.children[keys[i]] as CstElement[] | undefined;
        if (!children) continue;
        for (let j = children.length - 1; j >= 0; j--) {
            if (isCstNode(children[j])) {
                const found = findLastTokenInNode(children[j] as CstNode);
                if (found) return found;
            } else {
                return children[j] as IToken;
            }
        }
    }
    return undefined;
}

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

function visitNode(node: CstNode, visitor: (node: CstNode) => void): void {
    visitor(node);
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                visitNode(child, visitor);
            }
        }
    }
}
