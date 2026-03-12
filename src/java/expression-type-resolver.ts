/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { CstNode, IToken } from 'chevrotain';
import type { JavaSymbol, SymbolTable } from './symbol-table.js';
import type { WorkspaceIndex } from '../project/workspace-index.js';
import { findVisibleSymbols } from './scope-resolver.js';
import { getJdkType } from '../project/jdk-model.js';

export interface ExpressionTypeContext {
    symbolTable: SymbolTable;
    workspaceIndex?: WorkspaceIndex;
    /** Current position for scope resolution (0-based) */
    line: number;
    /** Current position for scope resolution (0-based) */
    column: number;
    /** The enclosing class name (for `this` resolution) */
    enclosingClassName?: string;
}

// ---------------------------------------------------------------------------
// CST helpers
// ---------------------------------------------------------------------------

function getChild(node: CstNode, name: string): CstNode | undefined {
    const children = node.children[name];
    if (!children || children.length === 0) return undefined;
    const child = children[0];
    return typeof child === 'object' && 'children' in child ? (child as CstNode) : undefined;
}

function getChildren(node: CstNode, name: string): CstNode[] {
    const children = node.children[name];
    if (!children) return [];
    return children.filter(
        (c): c is CstNode => typeof c === 'object' && 'children' in c,
    );
}

function getToken(node: CstNode, name: string): IToken | undefined {
    const tokens = node.children[name] as IToken[] | undefined;
    return tokens?.[0];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the type of a CST expression node.
 * Returns the type name string (e.g., "String", "int", "List<Pet>") or undefined.
 */
export function resolveExpressionType(
    exprNode: CstNode,
    context: ExpressionTypeContext,
): string | undefined {
    // The node may already be an "expression", "conditionalExpression",
    // "binaryExpression", "unaryExpression", or "primary".  We normalise
    // by walking inward until we reach `primary`.
    const primary = unwrapToPrimary(exprNode);
    if (!primary) {
        // May be a binary expression with operators – handle that separately
        return resolveBinaryOrConditional(exprNode, context);
    }

    // 1. Resolve the base type from primaryPrefix
    const prefix = getChild(primary, 'primaryPrefix');
    if (!prefix) return undefined;

    let currentType = resolvePrimaryPrefix(prefix, context);

    // 2. Chain primarySuffix operations
    const suffixes = getChildren(primary, 'primarySuffix');
    for (let i = 0; i < suffixes.length; i++) {
        if (!currentType) break;
        currentType = resolvePrimarySuffix(suffixes, i, currentType, context);
    }

    return currentType;
}

/**
 * Resolve the type of an identifier at a position by checking scope.
 * Checks: local variables, parameters, fields, class names.
 */
export function resolveIdentifierType(
    name: string,
    context: ExpressionTypeContext,
): string | undefined {
    const visible = findVisibleSymbols(
        context.symbolTable,
        context.line,
        context.column,
    );

    for (const sym of visible) {
        if (sym.name !== name) continue;

        switch (sym.kind) {
            case 'variable':
            case 'parameter':
            case 'field':
            case 'enumConstant':
                return sym.type;
            case 'method':
                return sym.returnType;
            case 'class':
            case 'interface':
            case 'enum':
            case 'record':
                return sym.name;
        }
    }

    // Check JDK types
    const jdkType = getJdkType(name);
    if (jdkType) return jdkType.name;

    return undefined;
}

// ---------------------------------------------------------------------------
// Unwrap expression → primary
// ---------------------------------------------------------------------------

/**
 * Walk through expression → conditionalExpression → binaryExpression →
 * unaryExpression → primary, returning the `primary` node.
 * Returns undefined if the binary expression contains operators (handled
 * separately by resolveBinaryOrConditional).
 */
function unwrapToPrimary(node: CstNode): CstNode | undefined {
    // If we're already at `primary`, return immediately
    if (node.name === 'primary') return node;

    // expression → conditionalExpression
    let current: CstNode | undefined = node;
    if (current.name === 'expression') {
        current = getChild(current, 'conditionalExpression');
        if (!current) return undefined;
    }

    // conditionalExpression → binaryExpression
    if (current.name === 'conditionalExpression') {
        current = getChild(current, 'binaryExpression');
        if (!current) return undefined;
    }

    // binaryExpression → check if it has operators
    if (current.name === 'binaryExpression') {
        const unaryExprs = getChildren(current, 'unaryExpression');
        if (unaryExprs.length > 1) return undefined; // binary op – handled elsewhere
        // Check for operator tokens that indicate this is a real binary expression
        if (hasBinaryOperator(current)) return undefined;
        current = unaryExprs[0];
        if (!current) return undefined;
    }

    // unaryExpression → primary
    if (current.name === 'unaryExpression') {
        current = getChild(current, 'primary');
        if (!current) return undefined;
    }

    return current?.name === 'primary' ? current : undefined;
}

/** Check if a binaryExpression node contains operator tokens. */
function hasBinaryOperator(binExpr: CstNode): boolean {
    const opNames = [
        'BinaryOperator', 'Instanceof',
        'Less', 'Greater', 'LessEquals', 'GreaterEquals',
        'Equals', 'NotEquals',
        'And', 'Or', 'BitwiseAnd', 'BitwiseOr', 'Xor',
        'Plus', 'Minus', 'Star', 'Slash', 'Percent',
        'LeftShift', 'RightShift', 'UnsignedRightShift',
    ];
    for (const name of opNames) {
        if (binExpr.children[name]?.length) return true;
    }
    // Also check for the generic BinaryOperator catch-all in java-parser
    for (const key of Object.keys(binExpr.children)) {
        const vals = binExpr.children[key];
        if (!vals) continue;
        for (const v of vals) {
            if (!('children' in v) && key !== 'unaryExpression') {
                // Token that isn't unaryExpression → likely an operator
                const img = (v as IToken).image;
                if (img && /^[+\-*/%<>=!&|^~?]+$/.test(img)) return true;
                if (img === 'instanceof') return true;
            }
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Primary prefix resolution
// ---------------------------------------------------------------------------

function resolvePrimaryPrefix(
    prefix: CstNode,
    ctx: ExpressionTypeContext,
): string | undefined {
    // Literal
    const literal = getChild(prefix, 'literal');
    if (literal) return resolveLiteralType(literal);

    // this
    if (getToken(prefix, 'This')) return ctx.enclosingClassName;

    // super
    if (getToken(prefix, 'Super')) return resolveSuperType(ctx);

    // new expression
    const newExpr = getChild(prefix, 'newExpression');
    if (newExpr) return resolveNewExpressionType(newExpr);

    // cast expression
    const cast = getChild(prefix, 'castExpression');
    if (cast) return resolveCastType(cast);

    // parenthesized expression
    const paren = getChild(prefix, 'parenthesisExpression');
    if (paren) {
        const inner = getChild(paren, 'expression');
        if (inner) return resolveExpressionType(inner, ctx);
        return undefined;
    }

    // fqnOrRefType (identifier / qualified name)
    const fqn = getChild(prefix, 'fqnOrRefType');
    if (fqn) return resolveFqnOrRefType(fqn, ctx);

    return undefined;
}

// ---------------------------------------------------------------------------
// Literal type resolution
// ---------------------------------------------------------------------------

function resolveLiteralType(literal: CstNode): string | undefined {
    // StringLiteral / TextBlock
    if (getToken(literal, 'StringLiteral') || getToken(literal, 'TextBlock')) {
        return 'String';
    }

    // integerLiteral
    const intLiteral = getChild(literal, 'integerLiteral');
    if (intLiteral) {
        const tok =
            getToken(intLiteral, 'DecimalLiteral') ??
            getToken(intLiteral, 'HexLiteral') ??
            getToken(intLiteral, 'OctalLiteral') ??
            getToken(intLiteral, 'BinaryLiteral');
        if (tok) {
            const img = tok.image;
            if (img.endsWith('L') || img.endsWith('l')) return 'long';
            return 'int';
        }
    }

    // floatingPointLiteral
    const fpLiteral = getChild(literal, 'floatingPointLiteral');
    if (fpLiteral) {
        const tok =
            getToken(fpLiteral, 'FloatLiteral') ??
            getToken(fpLiteral, 'DoubleLiteral');
        if (tok) {
            const img = tok.image;
            if (img.endsWith('f') || img.endsWith('F')) return 'float';
            return 'double';
        }
    }

    // booleanLiteral
    const boolLiteral = getChild(literal, 'booleanLiteral');
    if (boolLiteral) return 'boolean';

    // CharLiteral
    if (getToken(literal, 'CharLiteral')) return 'char';

    // Null
    if (getToken(literal, 'Null')) return 'null';

    return undefined;
}

// ---------------------------------------------------------------------------
// super resolution
// ---------------------------------------------------------------------------

function resolveSuperType(ctx: ExpressionTypeContext): string | undefined {
    if (!ctx.enclosingClassName) return undefined;
    // Find the enclosing class symbol and return its superclass
    const clsSym = ctx.symbolTable.allSymbols.find(
        s =>
            s.name === ctx.enclosingClassName &&
            ['class', 'record', 'enum'].includes(s.kind),
    );
    return clsSym?.superclass ?? 'Object';
}

// ---------------------------------------------------------------------------
// new expression resolution
// ---------------------------------------------------------------------------

function resolveNewExpressionType(newExpr: CstNode): string | undefined {
    const unqualified = getChild(
        newExpr,
        'unqualifiedClassInstanceCreationExpression',
    );
    if (unqualified) {
        const typeToInstantiate = getChild(
            unqualified,
            'classOrInterfaceTypeToInstantiate',
        );
        if (typeToInstantiate) {
            const id = getToken(typeToInstantiate, 'Identifier');
            return id?.image;
        }
    }
    // Array creation: new int[5], etc.
    // Not handled in depth – return undefined for now
    return undefined;
}

// ---------------------------------------------------------------------------
// cast expression resolution
// ---------------------------------------------------------------------------

function resolveCastType(cast: CstNode): string | undefined {
    // primitiveTypeCastExpression
    const primCast = getChild(cast, 'primitiveTypeCastExpression');
    if (primCast) {
        const primType = getChild(primCast, 'primitiveType');
        if (primType) return extractPrimitiveTypeName(primType);
    }

    // referenceTypeCastExpression
    const refCast = getChild(cast, 'referenceTypeCastExpression');
    if (refCast) {
        const refType = getChild(refCast, 'referenceType');
        if (refType) return extractReferenceTypeName(refType);
    }

    return undefined;
}

function extractPrimitiveTypeName(node: CstNode): string | undefined {
    const numType = getChild(node, 'numericType');
    if (numType) {
        const integral = getChild(numType, 'integralType');
        if (integral) {
            for (const name of ['Int', 'Long', 'Short', 'Byte', 'Char']) {
                const tok = getToken(integral, name);
                if (tok) return tok.image;
            }
        }
        const fp = getChild(numType, 'floatingPointType');
        if (fp) {
            for (const name of ['Float', 'Double']) {
                const tok = getToken(fp, name);
                if (tok) return tok.image;
            }
        }
    }
    if (getToken(node, 'Boolean')) return 'boolean';
    return undefined;
}

function extractReferenceTypeName(node: CstNode): string | undefined {
    const classOrIface = getChild(node, 'classOrInterfaceType');
    if (classOrIface) {
        const classType = getChild(classOrIface, 'classType');
        if (classType) {
            const id = getToken(classType, 'Identifier');
            return id?.image;
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// fqnOrRefType resolution
// ---------------------------------------------------------------------------

function resolveFqnOrRefType(
    fqn: CstNode,
    ctx: ExpressionTypeContext,
): string | undefined {
    const parts: string[] = [];

    const first = getChild(fqn, 'fqnOrRefTypePartFirst');
    if (first) {
        const common = getChild(first, 'fqnOrRefTypePartCommon');
        if (common) {
            const id = getToken(common, 'Identifier');
            if (id) parts.push(id.image);
        }
    }

    const rest = getChildren(fqn, 'fqnOrRefTypePartRest');
    for (const part of rest) {
        const common = getChild(part, 'fqnOrRefTypePartCommon');
        if (common) {
            const id = getToken(common, 'Identifier');
            if (id) parts.push(id.image);
        }
    }

    if (parts.length === 0) return undefined;

    // Single identifier – resolve as variable/field/class
    if (parts.length === 1) {
        return resolveIdentifierType(parts[0], ctx);
    }

    // Multi-part: could be qualified access (e.g., System.out or pkg.Class)
    // Try resolving the first part and then chain field accesses
    let currentType = resolveIdentifierType(parts[0], ctx);
    for (let i = 1; i < parts.length; i++) {
        if (!currentType) return undefined;
        currentType = resolveFieldType(currentType, parts[i], ctx);
    }
    return currentType;
}

// ---------------------------------------------------------------------------
// Primary suffix resolution
// ---------------------------------------------------------------------------

/**
 * Process a primary suffix at index i, returning the new current type.
 *
 * Suffix patterns from the CST:
 * - Dot + Identifier (field access or method name before invocation)
 * - methodInvocationSuffix (standalone method call on fqnOrRefType identifier)
 * - arrayAccessSuffix ([index])
 */
function resolvePrimarySuffix(
    suffixes: CstNode[],
    i: number,
    currentType: string,
    ctx: ExpressionTypeContext,
): string | undefined {
    const suffix = suffixes[i];

    // Method invocation suffix (standalone, e.g., getName())
    const methodInvoc = getChild(suffix, 'methodInvocationSuffix');
    if (methodInvoc) {
        // This suffix applies to an identifier from the prefix (already resolved
        // via fqnOrRefType as the method name).  The current type IS the method's
        // identifier type which was looked up via resolveIdentifierType — but we
        // actually need the method's return type.  When the prefix is a bare
        // identifier followed by methodInvocationSuffix, the prefix resolves
        // the identifier.  For the case where it was resolved as a method → returnType,
        // the resolveIdentifierType already returns returnType.
        // So just pass through.
        return currentType;
    }

    // Dot + Identifier — field access or method-name-before-invocation
    const dot = getToken(suffix, 'Dot');
    const identifier = getToken(suffix, 'Identifier');
    if (dot && identifier) {
        const memberName = identifier.image;

        // Check if the next suffix is a methodInvocationSuffix
        const nextSuffix = i + 1 < suffixes.length ? suffixes[i + 1] : undefined;
        const isMethodCall =
            nextSuffix && getChild(nextSuffix, 'methodInvocationSuffix');

        if (isMethodCall) {
            return resolveMethodReturnType(currentType, memberName, ctx);
        } else {
            return resolveFieldType(currentType, memberName, ctx);
        }
    }

    // Array access suffix
    const arrayAccess = getChild(suffix, 'arrayAccessSuffix');
    if (arrayAccess) {
        return stripArrayDimension(currentType);
    }

    return currentType;
}

// ---------------------------------------------------------------------------
// Member resolution helpers
// ---------------------------------------------------------------------------

function resolveMethodReturnType(
    typeName: string,
    methodName: string,
    ctx: ExpressionTypeContext,
): string | undefined {
    // 1. Check workspace symbols (enclosing class / symbol table)
    const baseType = stripGenericParams(typeName);
    const classSym = findClassSymbol(baseType, ctx);
    if (classSym) {
        const method = findMethodInHierarchy(classSym, methodName, ctx);
        if (method) return method.returnType;
    }

    // 2. Check JDK types
    const jdkType = getJdkType(baseType);
    if (jdkType) {
        const method = jdkType.methods.find(m => m.name === methodName);
        if (method) return method.returnType;
        // Walk superclass chain
        if (jdkType.superclass) {
            return resolveMethodReturnType(jdkType.superclass, methodName, ctx);
        }
    }

    return undefined;
}

function resolveFieldType(
    typeName: string,
    fieldName: string,
    ctx: ExpressionTypeContext,
): string | undefined {
    const baseType = stripGenericParams(typeName);
    // 1. Workspace symbols
    const classSym = findClassSymbol(baseType, ctx);
    if (classSym) {
        const field = findFieldInHierarchy(classSym, fieldName, ctx);
        if (field) return field.type;
    }

    // 2. JDK types
    const jdkType = getJdkType(baseType);
    if (jdkType) {
        const field = jdkType.fields.find(f => f.name === fieldName);
        if (field) return field.type;
        if (jdkType.superclass) {
            return resolveFieldType(jdkType.superclass, fieldName, ctx);
        }
    }

    return undefined;
}

function findClassSymbol(
    name: string,
    ctx: ExpressionTypeContext,
): JavaSymbol | undefined {
    // Check symbol table
    const sym = ctx.symbolTable.allSymbols.find(
        s => s.name === name && ['class', 'interface', 'enum', 'record'].includes(s.kind),
    );
    if (sym) return sym;

    // Check workspace index
    if (ctx.workspaceIndex) {
        const entry = ctx.workspaceIndex.findTypeByName(name);
        if (entry) {
            const st = ctx.workspaceIndex.getSymbolTable(entry.uri);
            if (st) {
                return st.allSymbols.find(
                    s => s.name === name && ['class', 'interface', 'enum', 'record'].includes(s.kind),
                );
            }
        }
    }

    return undefined;
}

function findMethodInHierarchy(
    classSym: JavaSymbol,
    methodName: string,
    ctx: ExpressionTypeContext,
): JavaSymbol | undefined {
    const method = classSym.children.find(
        c => c.kind === 'method' && c.name === methodName,
    );
    if (method) return method;

    // Walk superclass
    if (classSym.superclass) {
        const superSym = findClassSymbol(classSym.superclass, ctx);
        if (superSym) return findMethodInHierarchy(superSym, methodName, ctx);

        // Try JDK
        const jdkType = getJdkType(classSym.superclass);
        if (jdkType) {
            const jdkMethod = jdkType.methods.find(m => m.name === methodName);
            if (jdkMethod) {
                // Return a synthetic JavaSymbol-like object
                return {
                    name: jdkMethod.name,
                    kind: 'method',
                    returnType: jdkMethod.returnType,
                    modifiers: [],
                    line: 0,
                    column: 0,
                    endLine: 0,
                    endColumn: 0,
                    children: [],
                };
            }
        }
    }

    return undefined;
}

function findFieldInHierarchy(
    classSym: JavaSymbol,
    fieldName: string,
    ctx: ExpressionTypeContext,
): JavaSymbol | undefined {
    const field = classSym.children.find(
        c => c.kind === 'field' && c.name === fieldName,
    );
    if (field) return field;

    if (classSym.superclass) {
        const superSym = findClassSymbol(classSym.superclass, ctx);
        if (superSym) return findFieldInHierarchy(superSym, fieldName, ctx);
    }

    return undefined;
}

function stripArrayDimension(type: string): string {
    if (type.endsWith('[]')) return type.slice(0, -2);
    return type;
}

function stripGenericParams(type: string): string {
    const idx = type.indexOf('<');
    return idx >= 0 ? type.slice(0, idx) : type;
}

// ---------------------------------------------------------------------------
// Binary / conditional expression resolution
// ---------------------------------------------------------------------------

function resolveBinaryOrConditional(
    node: CstNode,
    ctx: ExpressionTypeContext,
): string | undefined {
    // Unwrap expression → conditionalExpression → binaryExpression
    let current: CstNode | undefined = node;
    if (current.name === 'expression') {
        current = getChild(current, 'conditionalExpression');
        if (!current) return undefined;
    }
    if (current.name === 'conditionalExpression') {
        // Ternary: if QuestionMark exists, result type is the type of the true branch
        if (getToken(current, 'QuestionMark')) {
            const exprs = getChildren(current, 'expression');
            if (exprs.length > 0) return resolveExpressionType(exprs[0], ctx);
        }
        current = getChild(current, 'binaryExpression');
        if (!current) return undefined;
    }
    if (current.name === 'binaryExpression') {
        return resolveBinaryExpressionType(current, ctx);
    }
    return undefined;
}

function resolveBinaryExpressionType(
    binExpr: CstNode,
    ctx: ExpressionTypeContext,
): string | undefined {
    const unaryExprs = getChildren(binExpr, 'unaryExpression');

    if (unaryExprs.length <= 1) {
        // Single operand, just resolve it
        if (unaryExprs.length === 1) {
            const primary = getChild(unaryExprs[0], 'primary');
            if (primary) {
                return resolveExpressionType(unaryExprs[0], ctx);
            }
        }
        return undefined;
    }

    // Collect operator tokens from the binary expression
    const ops = collectOperatorTokens(binExpr);

    // instanceof → boolean
    if (ops.some(op => op === 'instanceof')) return 'boolean';

    // Comparison operators → boolean
    if (ops.some(op => ['==', '!=', '<', '>', '<=', '>='].includes(op))) {
        return 'boolean';
    }

    // Logical operators → boolean
    if (ops.some(op => ['&&', '||'].includes(op))) return 'boolean';

    // Assignment → type of left side
    if (ops.some(op => op === '=')) {
        return resolveUnaryExprType(unaryExprs[0], ctx);
    }

    // String concatenation: if + and either side is String → String
    if (ops.some(op => op === '+')) {
        const leftType = resolveUnaryExprType(unaryExprs[0], ctx);
        const rightType =
            unaryExprs.length > 1
                ? resolveUnaryExprType(unaryExprs[1], ctx)
                : undefined;
        if (leftType === 'String' || rightType === 'String') return 'String';
    }

    // Arithmetic: numeric promotion
    if (ops.some(op => ['+', '-', '*', '/', '%'].includes(op))) {
        const types = unaryExprs
            .map(u => resolveUnaryExprType(u, ctx))
            .filter((t): t is string => t !== undefined);
        return promoteNumericTypes(types);
    }

    // Fallback: resolve first operand
    return resolveUnaryExprType(unaryExprs[0], ctx);
}

function resolveUnaryExprType(
    node: CstNode,
    ctx: ExpressionTypeContext,
): string | undefined {
    const primary = getChild(node, 'primary');
    if (primary) {
        // Construct a temporary node that looks like an expression wrapping this primary
        return resolveExpressionType(node, ctx);
    }
    return undefined;
}

function collectOperatorTokens(binExpr: CstNode): string[] {
    const ops: string[] = [];
    for (const [key, values] of Object.entries(binExpr.children)) {
        if (key === 'unaryExpression') continue;
        if (!values) continue;
        for (const v of values) {
            if (!('children' in v)) {
                const tok = v as IToken;
                if (tok.image) ops.push(tok.image);
            }
        }
    }
    return ops;
}

function promoteNumericTypes(types: string[]): string {
    const NUMERIC_RANK: Record<string, number> = {
        byte: 1,
        short: 2,
        char: 2,
        int: 3,
        long: 4,
        float: 5,
        double: 6,
    };

    let maxRank = 3; // default to int (numeric promotion rules)
    for (const t of types) {
        const rank = NUMERIC_RANK[t];
        if (rank !== undefined && rank > maxRank) maxRank = rank;
    }

    const rankToType: Record<number, string> = {
        1: 'int', // byte promotes to int
        2: 'int', // short/char promote to int
        3: 'int',
        4: 'long',
        5: 'float',
        6: 'double',
    };
    return rankToType[maxRank] ?? 'int';
}
