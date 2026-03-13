/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse } from 'java-parser';
import type { CstNode } from 'chevrotain';
import { buildSymbolTable } from './symbol-table.js';
import {
    resolveExpressionType,
    resolveIdentifierType,
    type ExpressionTypeContext,
} from './expression-type-resolver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAndBuild(code: string) {
    const cst = parse(code) as CstNode;
    const symbolTable = buildSymbolTable(cst);
    return { cst, symbolTable };
}

/**
 * Find all nodes with a given name in DFS order.
 */
function findAllNodes(node: CstNode, targetName: string): CstNode[] {
    const results: CstNode[] = [];
    if (node.name === targetName) results.push(node);
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children) {
            if (typeof child === 'object' && 'children' in child) {
                results.push(...findAllNodes(child as CstNode, targetName));
            }
        }
    }
    return results;
}

/**
 * Get the expression from the Nth variableInitializer in the CST (0-based).
 * Walks the entire CST to find variableDeclarator nodes that have an
 * initializer, skipping field declarations without one, then returns
 * the expression from the Nth match.
 */
function getNthExpression(cst: CstNode, n: number): CstNode | undefined {
    const declarators = findAllNodes(cst, 'variableDeclarator');
    let count = 0;
    for (const decl of declarators) {
        const vi = decl.children.variableInitializer?.[0];
        if (!vi || !('children' in vi)) continue;

        if (count === n) {
            const expr = (vi as CstNode).children.expression?.[0];
            return expr && typeof expr === 'object' && 'children' in expr
                ? (expr as CstNode)
                : undefined;
        }
        count++;
    }
    return undefined;
}

/**
 * Build a context from parsed code, placing the cursor inside the
 * last method body of the enclosing class.
 */
function makeContext(
    symbolTable: ReturnType<typeof buildSymbolTable>,
    enclosingClassName?: string,
): ExpressionTypeContext {
    // Find the last method in the enclosing class so the position is inside its scope
    const classSym = symbolTable.allSymbols.find(
        s => s.name === enclosingClassName && s.kind === 'class',
    );
    const methods = classSym?.children.filter(c => c.kind === 'method') ?? [];
    const lastMethod = methods[methods.length - 1];
    const line = lastMethod ? lastMethod.endLine : 0;

    return {
        symbolTable,
        line,
        column: 0,
        enclosingClassName,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveExpressionType', () => {
    it('should resolve String literal type', () => {
        const code = `
public class App {
    public void run() {
        String x = "hello";
    }
}`;
        const { cst, symbolTable } = parseAndBuild(code);
        const expr = getNthExpression(cst, 0);
        expect(expr).toBeDefined();

        const ctx = makeContext(symbolTable, 'App');
        const type = resolveExpressionType(expr!, ctx);
        expect(type).toBe('String');
    });

    it('should resolve int literal type', () => {
        const code = `
public class App {
    public void run() {
        int x = 42;
    }
}`;
        const { cst, symbolTable } = parseAndBuild(code);
        const expr = getNthExpression(cst, 0);
        expect(expr).toBeDefined();

        const ctx = makeContext(symbolTable, 'App');
        expect(resolveExpressionType(expr!, ctx)).toBe('int');
    });

    it('should resolve boolean literal type', () => {
        const code = `
public class App {
    public void run() {
        boolean x = true;
    }
}`;
        const { cst, symbolTable } = parseAndBuild(code);
        const expr = getNthExpression(cst, 0);
        expect(expr).toBeDefined();

        const ctx = makeContext(symbolTable, 'App');
        expect(resolveExpressionType(expr!, ctx)).toBe('boolean');
    });

    it('should resolve null literal type', () => {
        const code = `
public class App {
    public void run() {
        Object x = null;
    }
}`;
        const { cst, symbolTable } = parseAndBuild(code);
        const expr = getNthExpression(cst, 0);
        expect(expr).toBeDefined();

        const ctx = makeContext(symbolTable, 'App');
        expect(resolveExpressionType(expr!, ctx)).toBe('null');
    });

    it('should resolve variable reference type', () => {
        const code = `
public class App {
    public void run() {
        String name = "foo";
        String x = name;
    }
}`;
        const { cst, symbolTable } = parseAndBuild(code);
        // The second variableDeclarator (x = name)
        const expr = getNthExpression(cst, 1);
        expect(expr).toBeDefined();

        // Place cursor after 'name' declaration
        const nameSym = symbolTable.allSymbols.find(
            s => s.name === 'name' && s.kind === 'variable',
        );
        expect(nameSym).toBeDefined();

        const ctx: ExpressionTypeContext = {
            symbolTable,
            line: nameSym!.line + 1,
            column: 0,
            enclosingClassName: 'App',
        };
        expect(resolveExpressionType(expr!, ctx)).toBe('String');
    });

    it('should resolve this.field access type', () => {
        const code = `
public class App {
    private String name;
    public void run() {
        String x = this.name;
    }
}`;
        const { cst, symbolTable } = parseAndBuild(code);
        // Field `name` has no initializer and is skipped; `x = this.name` is index 0
        const expr = getNthExpression(cst, 0);
        expect(expr).toBeDefined();

        const ctx = makeContext(symbolTable, 'App');
        expect(resolveExpressionType(expr!, ctx)).toBe('String');
    });

    it('should resolve new expression type', () => {
        const code = `
public class App {
    public void run() {
        Object x = new ArrayList();
    }
}`;
        const { cst, symbolTable } = parseAndBuild(code);
        const expr = getNthExpression(cst, 0);
        expect(expr).toBeDefined();

        const ctx = makeContext(symbolTable, 'App');
        expect(resolveExpressionType(expr!, ctx)).toBe('ArrayList');
    });

    it('should resolve method return type', () => {
        const code = `
public class App {
    public String getName() {
        return "test";
    }
    public void run() {
        String x = getName();
    }
}`;
        const { cst, symbolTable } = parseAndBuild(code);
        // `return "test"` is a return statement, not a variableDeclarator.
        // Only variableDeclarator is `x = getName()` at index 0.
        const expr = getNthExpression(cst, 0);
        expect(expr).toBeDefined();

        const ctx = makeContext(symbolTable, 'App');
        expect(resolveExpressionType(expr!, ctx)).toBe('String');
    });
});

describe('resolveIdentifierType', () => {
    it('should resolve variable type from scope', () => {
        const code = `
public class App {
    public void run() {
        String name = "foo";
        int count = 0;
    }
}`;
        const { symbolTable } = parseAndBuild(code);
        const nameSym = symbolTable.allSymbols.find(
            s => s.name === 'name' && s.kind === 'variable',
        );
        expect(nameSym).toBeDefined();

        // Place cursor after both declarations
        const countSym = symbolTable.allSymbols.find(
            s => s.name === 'count' && s.kind === 'variable',
        );
        expect(countSym).toBeDefined();

        const ctx: ExpressionTypeContext = {
            symbolTable,
            line: countSym!.line + 1,
            column: 0,
            enclosingClassName: 'App',
        };
        expect(resolveIdentifierType('name', ctx)).toBe('String');
        expect(resolveIdentifierType('count', ctx)).toBe('int');
    });

    it('should resolve class name as type', () => {
        const code = `
public class App {
    public void run() {
    }
}`;
        const { symbolTable } = parseAndBuild(code);
        const ctx = makeContext(symbolTable, 'App');
        expect(resolveIdentifierType('App', ctx)).toBe('App');
    });

    it('should resolve JDK type names', () => {
        const code = `
public class App {
    public void run() {
    }
}`;
        const { symbolTable } = parseAndBuild(code);
        const ctx = makeContext(symbolTable, 'App');
        expect(resolveIdentifierType('String', ctx)).toBe('String');
    });
});
