/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { extractDocumentSymbols } from './document-symbols.js';
import { parseJava } from '../java/parser.js';
import lsp from 'vscode-languageserver';

function getSymbols(code: string): lsp.DocumentSymbol[] {
    const result = parseJava(code);
    if (!result.cst) return [];
    return extractDocumentSymbols(result.cst);
}

function findSymbol(symbols: lsp.DocumentSymbol[], name: string): lsp.DocumentSymbol | undefined {
    for (const sym of symbols) {
        if (sym.name === name) return sym;
        if (sym.children) {
            const found = findSymbol(sym.children, name);
            if (found) return found;
        }
    }
    return undefined;
}

describe('extractDocumentSymbols', () => {
    it('should extract a simple class', () => {
        const symbols = getSymbols(`
public class Hello {
}
        `);
        const hello = findSymbol(symbols, 'Hello');
        expect(hello).toBeDefined();
        expect(hello!.kind).toBe(lsp.SymbolKind.Class);
    });

    it('should extract methods and fields', () => {
        const symbols = getSymbols(`
public class Person {
    private String name;
    private int age;

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
        `);
        const person = findSymbol(symbols, 'Person');
        expect(person).toBeDefined();
        expect(person!.children).toBeDefined();

        const nameField = findSymbol(person!.children!, 'name');
        expect(nameField).toBeDefined();
        expect(nameField!.kind).toBe(lsp.SymbolKind.Field);

        const getName = findSymbol(person!.children!, 'getName');
        expect(getName).toBeDefined();
        expect(getName!.kind).toBe(lsp.SymbolKind.Method);

        const setName = findSymbol(person!.children!, 'setName');
        expect(setName).toBeDefined();
        expect(setName!.kind).toBe(lsp.SymbolKind.Method);
    });

    it('should extract constructors', () => {
        const symbols = getSymbols(`
public class Foo {
    public Foo(int x) {
    }
}
        `);
        const foo = findSymbol(symbols, 'Foo');
        expect(foo).toBeDefined();
        // Constructor should be a child of the class
        const constructors = foo!.children!.filter(c => c.kind === lsp.SymbolKind.Constructor);
        expect(constructors.length).toBe(1);
    });

    it('should extract enums with members', () => {
        const symbols = getSymbols(`
public enum Color {
    RED, GREEN, BLUE;

    public String display() {
        return name().toLowerCase();
    }
}
        `);
        const color = findSymbol(symbols, 'Color');
        expect(color).toBeDefined();
        expect(color!.kind).toBe(lsp.SymbolKind.Enum);

        const red = findSymbol(color!.children!, 'RED');
        expect(red).toBeDefined();
        expect(red!.kind).toBe(lsp.SymbolKind.EnumMember);

        const display = findSymbol(color!.children!, 'display');
        expect(display).toBeDefined();
        expect(display!.kind).toBe(lsp.SymbolKind.Method);
    });

    it('should extract interfaces', () => {
        const symbols = getSymbols(`
public interface Runnable {
    void run();
}
        `);
        const runnable = findSymbol(symbols, 'Runnable');
        expect(runnable).toBeDefined();
        expect(runnable!.kind).toBe(lsp.SymbolKind.Interface);

        const run = findSymbol(runnable!.children!, 'run');
        expect(run).toBeDefined();
        expect(run!.kind).toBe(lsp.SymbolKind.Method);
    });

    it('should extract nested classes', () => {
        const symbols = getSymbols(`
public class Outer {
    public static class Inner {
        private int value;
    }
}
        `);
        const outer = findSymbol(symbols, 'Outer');
        expect(outer).toBeDefined();

        const inner = findSymbol(outer!.children!, 'Inner');
        expect(inner).toBeDefined();
        expect(inner!.kind).toBe(lsp.SymbolKind.Class);

        const value = findSymbol(inner!.children!, 'value');
        expect(value).toBeDefined();
        expect(value!.kind).toBe(lsp.SymbolKind.Field);
    });

    it('should extract package declaration', () => {
        const symbols = getSymbols(`
package com.example;

public class App {
}
        `);
        const pkg = symbols.find(s => s.kind === lsp.SymbolKind.Package);
        expect(pkg).toBeDefined();
    });

    it('should handle empty file', () => {
        const symbols = getSymbols('');
        expect(symbols).toHaveLength(0);
    });
});
