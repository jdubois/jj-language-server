/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseJava } from './parser.js';

describe('parseJava', () => {
    it('should parse a valid Java class with no errors', () => {
        const result = parseJava(`
public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
        `);
        expect(result.errors).toHaveLength(0);
        expect(result.cst).toBeDefined();
    });

    it('should parse a valid interface', () => {
        const result = parseJava(`
public interface Greeter {
    String greet(String name);
}
        `);
        expect(result.errors).toHaveLength(0);
        expect(result.cst).toBeDefined();
    });

    it('should parse an enum', () => {
        const result = parseJava(`
public enum Color {
    RED, GREEN, BLUE;
}
        `);
        expect(result.errors).toHaveLength(0);
        expect(result.cst).toBeDefined();
    });

    it('should parse a record', () => {
        const result = parseJava(`
public record Point(int x, int y) {}
        `);
        expect(result.errors).toHaveLength(0);
        expect(result.cst).toBeDefined();
    });

    it('should report errors for invalid syntax', () => {
        const result = parseJava(`
public class Broken {
    public void method( {
    }
}
        `);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should report errors for missing semicolon', () => {
        const result = parseJava(`
public class Missing {
    int x = 5
}
        `);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle empty input', () => {
        const result = parseJava('');
        expect(result.errors).toHaveLength(0);
    });

    it('should parse a class with generics', () => {
        const result = parseJava(`
import java.util.List;
import java.util.Map;

public class Container<T extends Comparable<T>> {
    private List<T> items;

    public Map<String, List<T>> getGrouped() {
        return null;
    }
}
        `);
        expect(result.errors).toHaveLength(0);
        expect(result.cst).toBeDefined();
    });

    it('should parse annotations', () => {
        const result = parseJava(`
import java.lang.annotation.*;

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface MyAnnotation {
    String value() default "";
}
        `);
        expect(result.errors).toHaveLength(0);
        expect(result.cst).toBeDefined();
    });

    it('should parse lambda expressions', () => {
        const result = parseJava(`
import java.util.List;

public class Lambdas {
    public void run() {
        List<String> items = List.of("a", "b");
        items.forEach(item -> System.out.println(item));
        items.forEach((String item) -> {
            System.out.println(item);
        });
    }
}
        `);
        expect(result.errors).toHaveLength(0);
        expect(result.cst).toBeDefined();
    });
});
