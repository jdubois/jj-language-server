/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { buildSymbolTable } from './symbol-table.js';
import { parseJava } from './parser.js';

function getTable(code: string) {
    const result = parseJava(code);
    if (!result.cst) throw new Error('Parse failed');
    return buildSymbolTable(result.cst);
}

describe('buildSymbolTable', () => {
    it('should extract class with fields and methods', () => {
        const table = getTable(`
public class Person {
    private String name;
    private int age;

    public Person(String name, int age) {
        this.name = name;
        this.age = age;
    }

    public String getName() {
        return name;
    }

    public void setAge(int age) {
        this.age = age;
    }
}
        `);

        expect(table.symbols).toHaveLength(1);
        const person = table.symbols[0];
        expect(person.name).toBe('Person');
        expect(person.kind).toBe('class');

        const nameField = person.children.find(c => c.name === 'name' && c.kind === 'field');
        expect(nameField).toBeDefined();
        expect(nameField!.type).toContain('String');

        const constructor = person.children.find(c => c.kind === 'constructor');
        expect(constructor).toBeDefined();
        expect(constructor!.parameters).toHaveLength(2);

        const getName = person.children.find(c => c.name === 'getName');
        expect(getName).toBeDefined();
        expect(getName!.kind).toBe('method');
        expect(getName!.returnType).toContain('String');

        const setAge = person.children.find(c => c.name === 'setAge');
        expect(setAge).toBeDefined();
        expect(setAge!.parameters).toHaveLength(1);
        expect(setAge!.parameters![0].name).toBe('age');
    });

    it('should extract enum with constants', () => {
        const table = getTable(`
public enum Color {
    RED, GREEN, BLUE;
}
        `);

        const color = table.symbols[0];
        expect(color.kind).toBe('enum');
        expect(color.children.length).toBeGreaterThanOrEqual(3);

        const red = color.children.find(c => c.name === 'RED');
        expect(red).toBeDefined();
        expect(red!.kind).toBe('enumConstant');
    });

    it('should extract interface methods', () => {
        const table = getTable(`
public interface Callable {
    String call(int timeout);
}
        `);

        const callable = table.symbols[0];
        expect(callable.kind).toBe('interface');
        const call = callable.children.find(c => c.name === 'call');
        expect(call).toBeDefined();
        expect(call!.kind).toBe('method');
    });

    it('should extract local variables', () => {
        const table = getTable(`
public class App {
    public void run() {
        int count = 0;
        String message = "hello";
    }
}
        `);

        const run = table.allSymbols.find(s => s.name === 'run' && s.kind === 'method');
        expect(run).toBeDefined();
        const localVars = run!.children.filter(c => c.kind === 'variable');
        expect(localVars.length).toBeGreaterThanOrEqual(2);
    });

    it('should provide a flat allSymbols list', () => {
        const table = getTable(`
public class Outer {
    public static class Inner {
        private int value;
    }
}
        `);

        // allSymbols should include Outer, Inner, and value
        expect(table.allSymbols.find(s => s.name === 'Outer')).toBeDefined();
        expect(table.allSymbols.find(s => s.name === 'Inner')).toBeDefined();
        expect(table.allSymbols.find(s => s.name === 'value')).toBeDefined();
    });
});
