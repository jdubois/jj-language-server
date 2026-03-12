/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseJava } from './parser.js';
import { buildSymbolTable } from './symbol-table.js';
import type { SymbolTable, JavaSymbol } from './symbol-table.js';
import {
    resolveTypeString,
    resolveSymbolType,
    findTypeMembers,
    resolveMethodReturnType,
    resolveFieldType,
} from './type-resolver.js';
import type { TypeContext } from './type-resolver.js';

function buildContext(code: string): TypeContext {
    const result = parseJava(code);
    if (!result.cst) throw new Error('Parse failed');
    const symbolTable = buildSymbolTable(result.cst);
    return { symbolTable };
}

/** Minimal empty context for pure type-string tests */
function emptyContext(): TypeContext {
    return { symbolTable: { symbols: [], allSymbols: [] } };
}

describe('resolveTypeString', () => {
    it('should resolve primitive types', () => {
        const ctx = emptyContext();
        const resolved = resolveTypeString('int', ctx);
        expect(resolved.simpleName).toBe('int');
        expect(resolved.isPrimitive).toBe(true);
        expect(resolved.isArray).toBe(false);
        expect(resolved.arrayDimensions).toBe(0);
    });

    it('should resolve simple class types', () => {
        const ctx = emptyContext();
        const resolved = resolveTypeString('String', ctx);
        expect(resolved.simpleName).toBe('String');
        expect(resolved.isPrimitive).toBe(false);
        expect(resolved.qualifiedName).toBe('java.lang.String');
    });

    it('should resolve array types', () => {
        const ctx = emptyContext();
        const resolved = resolveTypeString('int[]', ctx);
        expect(resolved.simpleName).toBe('int');
        expect(resolved.isArray).toBe(true);
        expect(resolved.arrayDimensions).toBe(1);
        expect(resolved.isPrimitive).toBe(true);
    });

    it('should resolve multi-dimensional arrays', () => {
        const ctx = emptyContext();
        const resolved = resolveTypeString('String[][]', ctx);
        expect(resolved.simpleName).toBe('String');
        expect(resolved.isArray).toBe(true);
        expect(resolved.arrayDimensions).toBe(2);
    });

    it('should resolve generic types', () => {
        const ctx = emptyContext();
        const resolved = resolveTypeString('List<String>', ctx);
        expect(resolved.simpleName).toBe('List');
        expect(resolved.typeArguments).toEqual(['String']);
        expect(resolved.isPrimitive).toBe(false);
    });

    it('should resolve nested generic types', () => {
        const ctx = emptyContext();
        const resolved = resolveTypeString('Map<String, List<Integer>>', ctx);
        expect(resolved.simpleName).toBe('Map');
        expect(resolved.typeArguments).toEqual(['String', 'List<Integer>']);
    });
});

describe('resolveSymbolType', () => {
    it('should resolve type for a field symbol', () => {
        const ctx = emptyContext();
        const symbol: JavaSymbol = {
            name: 'items',
            kind: 'field',
            type: 'List<String>',
            modifiers: ['private'],
            line: 0,
            column: 0,
            endLine: 0,
            endColumn: 0,
            children: [],
        };

        const resolved = resolveSymbolType(symbol, ctx);
        expect(resolved).toBeDefined();
        expect(resolved!.simpleName).toBe('List');
        expect(resolved!.typeArguments).toEqual(['String']);
        expect(resolved!.isPrimitive).toBe(false);
    });

    it('should resolve return type for a method symbol', () => {
        const ctx = emptyContext();
        const symbol: JavaSymbol = {
            name: 'isActive',
            kind: 'method',
            returnType: 'boolean',
            modifiers: ['public'],
            line: 0,
            column: 0,
            endLine: 0,
            endColumn: 0,
            children: [],
            parameters: [],
        };

        const resolved = resolveSymbolType(symbol, ctx);
        expect(resolved).toBeDefined();
        expect(resolved!.simpleName).toBe('boolean');
        expect(resolved!.isPrimitive).toBe(true);
    });
});

describe('findTypeMembers', () => {
    it('should find members for a JDK type (String)', () => {
        const ctx = emptyContext();
        const { methods, fields } = findTypeMembers('String', ctx);

        const methodNames = methods.map(m => m.name);
        expect(methodNames).toContain('length');
        expect(methodNames).toContain('charAt');
        expect(methodNames).toContain('substring');
    });

    it('should find members for a workspace type', () => {
        const ctx = buildContext(`
public class Pet {
    private String name;
    private int age;

    public String getName() { return name; }
    public void setAge(int age) { this.age = age; }
}
        `);

        const { methods, fields } = findTypeMembers('Pet', ctx);

        const methodNames = methods.map(m => m.name);
        expect(methodNames).toContain('getName');
        expect(methodNames).toContain('setAge');

        const fieldNames = fields.map(f => f.name);
        expect(fieldNames).toContain('name');
        expect(fieldNames).toContain('age');
    });

    it('should include inherited members from JDK superclass', () => {
        const ctx = emptyContext();
        const { methods } = findTypeMembers('String', ctx);

        // String extends Object, so should also have Object methods
        const methodNames = methods.map(m => m.name);
        expect(methodNames).toContain('length');    // String's own method
        expect(methodNames).toContain('hashCode');  // Inherited from Object
    });
});

describe('resolveMethodReturnType', () => {
    it('should resolve JDK method return type', () => {
        const ctx = emptyContext();
        const resolved = resolveMethodReturnType('String', 'length', ctx);
        expect(resolved).toBeDefined();
        expect(resolved!.simpleName).toBe('int');
        expect(resolved!.isPrimitive).toBe(true);
    });

    it('should return undefined for unknown method', () => {
        const ctx = emptyContext();
        const resolved = resolveMethodReturnType('String', 'nonExistent', ctx);
        expect(resolved).toBeUndefined();
    });
});

describe('resolveFieldType', () => {
    it('should resolve workspace field type', () => {
        const ctx = buildContext(`
public class Owner {
    private String name;
    private int id;
}
        `);

        const resolved = resolveFieldType('Owner', 'name', ctx);
        expect(resolved).toBeDefined();
        expect(resolved!.simpleName).toBe('String');
        expect(resolved!.isPrimitive).toBe(false);

        const resolvedId = resolveFieldType('Owner', 'id', ctx);
        expect(resolvedId).toBeDefined();
        expect(resolvedId!.simpleName).toBe('int');
        expect(resolvedId!.isPrimitive).toBe(true);
    });

    it('should return undefined for unknown field', () => {
        const ctx = emptyContext();
        const resolved = resolveFieldType('String', 'nonExistent', ctx);
        expect(resolved).toBeUndefined();
    });
});

describe('inherited members via workspace types', () => {
    it('should inherit methods from a parsed parent class', () => {
        const ctx = buildContext(`
public class Animal {
    public String speak() { return "..."; }
}

public class Dog extends Animal {
    public String fetch() { return "ball"; }
}
        `);

        const { methods } = findTypeMembers('Dog', ctx);
        const methodNames = methods.map(m => m.name);
        expect(methodNames).toContain('fetch');  // Dog's own method
        expect(methodNames).toContain('speak');  // Inherited from Animal
    });
});
