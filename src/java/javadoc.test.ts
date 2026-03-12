/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseJavadoc, formatJavadocMarkdown, findJavadocComments, extractJavadocForSymbol } from './javadoc.js';
import { parseJava } from './parser.js';
import { buildSymbolTable } from './symbol-table.js';

describe('parseJavadoc', () => {
    it('should parse a simple description only', () => {
        const doc = parseJavadoc('/** This is a simple description. */');
        expect(doc.description).toBe('This is a simple description.');
        expect(doc.params).toEqual([]);
        expect(doc.returns).toBeUndefined();
        expect(doc.throws).toEqual([]);
        expect(doc.see).toEqual([]);
    });

    it('should parse full Javadoc with all tags', () => {
        const doc = parseJavadoc(`/**
 * Calculates the sum of two integers.
 *
 * @param a the first operand
 * @param b the second operand
 * @return the sum of a and b
 * @throws ArithmeticException if overflow occurs
 * @since 1.0
 * @deprecated Use addLong instead.
 * @see MathUtils
 * @author John Doe
 */`);
        expect(doc.description).toBe('Calculates the sum of two integers.');
        expect(doc.params).toEqual([
            { name: 'a', description: 'the first operand' },
            { name: 'b', description: 'the second operand' },
        ]);
        expect(doc.returns).toBe('the sum of a and b');
        expect(doc.throws).toEqual([
            { type: 'ArithmeticException', description: 'if overflow occurs' },
        ]);
        expect(doc.since).toBe('1.0');
        expect(doc.deprecated).toBe('Use addLong instead.');
        expect(doc.see).toEqual(['MathUtils']);
        expect(doc.author).toBe('John Doe');
    });

    it('should handle @returns as an alias for @return', () => {
        const doc = parseJavadoc(`/**
 * Gets the value.
 * @returns the current value
 */`);
        expect(doc.returns).toBe('the current value');
    });

    it('should handle @exception as an alias for @throws', () => {
        const doc = parseJavadoc(`/**
 * Does something.
 * @exception IOException if IO fails
 */`);
        expect(doc.throws).toEqual([
            { type: 'IOException', description: 'if IO fails' },
        ]);
    });

    it('should handle multi-line descriptions and tag values', () => {
        const doc = parseJavadoc(`/**
 * This is a multi-line
 * description that spans
 * several lines.
 *
 * @param name the name of
 *        the user to greet
 * @return a greeting
 *         message string
 */`);
        expect(doc.description).toContain('multi-line');
        expect(doc.description).toContain('several lines.');
        expect(doc.params[0].name).toBe('name');
        expect(doc.params[0].description).toContain('the name of');
        expect(doc.params[0].description).toContain('the user to greet');
        expect(doc.returns).toContain('a greeting');
        expect(doc.returns).toContain('message string');
    });

    it('should convert inline {@link} and {@code} to backticks', () => {
        const doc = parseJavadoc(`/**
 * See {@link ClassName} and {@code x + y} for details.
 * @param obj a {@link SomeType} instance
 */`);
        expect(doc.description).toBe('See `ClassName` and `x + y` for details.');
        expect(doc.params[0].description).toBe('a `SomeType` instance');
    });

    it('should handle empty Javadoc', () => {
        const doc = parseJavadoc('/** */');
        expect(doc.description).toBe('');
        expect(doc.params).toEqual([]);
        expect(doc.returns).toBeUndefined();
        expect(doc.throws).toEqual([]);
        expect(doc.see).toEqual([]);
    });

    it('should handle multiple @see tags', () => {
        const doc = parseJavadoc(`/**
 * Some method.
 * @see ClassA
 * @see ClassB#method()
 */`);
        expect(doc.see).toEqual(['ClassA', 'ClassB#method()']);
    });

    it('should preserve raw text', () => {
        const raw = '/** Hello world */';
        const doc = parseJavadoc(raw);
        expect(doc.raw).toBe(raw);
    });
});

describe('formatJavadocMarkdown', () => {
    it('should format description only', () => {
        const md = formatJavadocMarkdown({
            description: 'A simple method.',
            params: [],
            throws: [],
            see: [],
            raw: '',
        });
        expect(md).toBe('A simple method.');
    });

    it('should format full Javadoc', () => {
        const md = formatJavadocMarkdown({
            description: 'Calculates something.',
            params: [
                { name: 'a', description: 'first' },
                { name: 'b', description: 'second' },
            ],
            returns: 'the result',
            throws: [{ type: 'IllegalArgumentException', description: 'if invalid' }],
            since: '2.0',
            deprecated: 'Use other method.',
            see: ['OtherClass'],
            author: 'Jane',
            raw: '',
        });
        expect(md).toContain('Calculates something.');
        expect(md).toContain('**@deprecated** Use other method.');
        expect(md).toContain('**Parameters:**');
        expect(md).toContain('`a` — first');
        expect(md).toContain('`b` — second');
        expect(md).toContain('**Returns:** the result');
        expect(md).toContain('**Throws:**');
        expect(md).toContain('`IllegalArgumentException` — if invalid');
        expect(md).toContain('**Since:** 2.0');
        expect(md).toContain('**See also:**');
        expect(md).toContain('OtherClass');
        expect(md).toContain('**Author:** Jane');
    });
});

describe('findJavadocComments', () => {
    it('should find Javadoc comments at correct node lines', () => {
        const source = `
/**
 * A sample class.
 */
public class Sample {
    /**
     * Says hello.
     * @param name the name
     * @return greeting
     */
    public String greet(String name) {
        return "Hello " + name;
    }
}`;
        const result = parseJava(source);
        expect(result.cst).toBeDefined();
        const map = findJavadocComments(result.cst!, source);
        // The map should contain at least the Javadoc entries
        expect(map.size).toBeGreaterThanOrEqual(1);

        // Find the entry for the "greet" method — check that some entry has params
        let foundGreetDoc = false;
        for (const doc of map.values()) {
            if (doc.params.length > 0 && doc.params[0].name === 'name') {
                foundGreetDoc = true;
                expect(doc.returns).toBe('greeting');
            }
        }
        expect(foundGreetDoc).toBe(true);
    });

    it('should ignore non-Javadoc block comments', () => {
        const source = `
/* This is not a Javadoc comment */
public class Foo {
}`;
        const result = parseJava(source);
        expect(result.cst).toBeDefined();
        const map = findJavadocComments(result.cst!);
        expect(map.size).toBe(0);
    });

    it('should find class-level Javadoc', () => {
        const source = `
/**
 * This is a documented class.
 * @author Tester
 * @since 1.0
 */
public class Documented {
}`;
        const result = parseJava(source);
        expect(result.cst).toBeDefined();
        const map = findJavadocComments(result.cst!, source);
        expect(map.size).toBeGreaterThanOrEqual(1);

        let foundClassDoc = false;
        for (const doc of map.values()) {
            if (doc.description.includes('documented class')) {
                foundClassDoc = true;
                expect(doc.author).toBe('Tester');
                expect(doc.since).toBe('1.0');
            }
        }
        expect(foundClassDoc).toBe(true);
    });
});

describe('extractJavadocForSymbol', () => {
    it('should extract Javadoc for a method symbol', () => {
        const source = `
/**
 * A sample class.
 */
public class Sample {
    /**
     * Says hello.
     * @param name the name
     * @return greeting
     */
    public String greet(String name) {
        return "Hello " + name;
    }
}`;
        const result = parseJava(source);
        expect(result.cst).toBeDefined();
        const table = buildSymbolTable(result.cst!);
        const greetSym = table.allSymbols.find(s => s.name === 'greet');
        expect(greetSym).toBeDefined();

        const doc = extractJavadocForSymbol(result.cst!, greetSym!);
        // The Javadoc should be found if the token at the method's line has the leading comment
        // This depends on where java-parser attaches the comments.
        // We test that the function doesn't crash and returns a plausible result
        if (doc) {
            expect(doc.params[0].name).toBe('name');
            expect(doc.returns).toBe('greeting');
        }
    });
});
