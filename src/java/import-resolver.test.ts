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
import { buildImportMap, resolveTypeName, JAVA_LANG_TYPES } from './import-resolver.js';

function getImportMap(code: string) {
    const cst = parse(code) as CstNode;
    return buildImportMap(cst);
}

describe('buildImportMap', () => {
    it('should parse a single type import', () => {
        const map = getImportMap(`
            import java.util.List;
            class Foo {}
        `);
        expect(map.imports.has('List')).toBe(true);
        const info = map.imports.get('List')!;
        expect(info.simpleName).toBe('List');
        expect(info.qualifiedName).toBe('java.util.List');
        expect(info.isWildcard).toBe(false);
        expect(info.isStatic).toBe(false);
    });

    it('should parse a wildcard import', () => {
        const map = getImportMap(`
            import java.util.*;
            class Foo {}
        `);
        expect(map.wildcardPackages).toContain('java.util');
    });

    it('should parse a static import', () => {
        const map = getImportMap(`
            import static java.lang.Math.PI;
            class Foo {}
        `);
        expect(map.staticImports.has('PI')).toBe(true);
        const info = map.staticImports.get('PI')!;
        expect(info.simpleName).toBe('PI');
        expect(info.qualifiedName).toBe('java.lang.Math.PI');
        expect(info.isStatic).toBe(true);
        expect(info.isWildcard).toBe(false);
    });

    it('should parse a static wildcard import', () => {
        const map = getImportMap(`
            import static java.lang.Math.*;
            class Foo {}
        `);
        expect(map.staticWildcardClasses).toContain('java.lang.Math');
    });

    it('should extract the package declaration', () => {
        const map = getImportMap(`
            package com.example;
            class Foo {}
        `);
        expect(map.packageName).toBe('com.example');
    });

    it('should handle multiple imports', () => {
        const map = getImportMap(`
            import java.util.List;
            import java.util.Map;
            import java.io.*;
            class Foo {}
        `);
        expect(map.imports.has('List')).toBe(true);
        expect(map.imports.has('Map')).toBe(true);
        expect(map.wildcardPackages).toContain('java.io');
    });

    it('should handle file with no imports', () => {
        const map = getImportMap('class Foo {}');
        expect(map.imports.size).toBe(0);
        expect(map.wildcardPackages).toHaveLength(0);
        expect(map.packageName).toBe('');
    });

    it('should record import line numbers (0-based)', () => {
        const map = getImportMap(`import java.util.List;
class Foo {}`);
        const info = map.imports.get('List')!;
        expect(info.line).toBe(0);
    });
});

describe('resolveTypeName', () => {
    it('should resolve explicit imports over wildcards', () => {
        const map = getImportMap(`
            import java.util.List;
            import java.io.*;
            class Foo {}
        `);
        expect(resolveTypeName('List', map)).toBe('java.util.List');
    });

    it('should resolve java.lang types without explicit import', () => {
        const map = getImportMap('class Foo {}');
        expect(resolveTypeName('String', map)).toBe('java.lang.String');
        expect(resolveTypeName('Object', map)).toBe('java.lang.Object');
        expect(resolveTypeName('Integer', map)).toBe('java.lang.Integer');
        expect(resolveTypeName('Override', map)).toBe('java.lang.Override');
    });

    it('should leave primitive types unchanged', () => {
        const map = getImportMap('class Foo {}');
        expect(resolveTypeName('int', map)).toBe('int');
        expect(resolveTypeName('long', map)).toBe('long');
        expect(resolveTypeName('boolean', map)).toBe('boolean');
        expect(resolveTypeName('void', map)).toBe('void');
    });

    it('should leave already-qualified names unchanged', () => {
        const map = getImportMap('class Foo {}');
        expect(resolveTypeName('java.util.List', map)).toBe('java.util.List');
    });

    it('should return undefined for unresolvable names with no wildcards', () => {
        const map = getImportMap('class Foo {}');
        expect(resolveTypeName('UnknownType', map)).toBeUndefined();
    });

    it('should best-guess resolve via single wildcard package', () => {
        const map = getImportMap(`
            import java.util.*;
            class Foo {}
        `);
        expect(resolveTypeName('ArrayList', map)).toBe('java.util.ArrayList');
    });

    it('should return undefined with multiple wildcard packages (ambiguous)', () => {
        const map = getImportMap(`
            import java.util.*;
            import java.io.*;
            class Foo {}
        `);
        expect(resolveTypeName('SomeType', map)).toBeUndefined();
    });

    it('should prioritize explicit import over java.lang', () => {
        // If someone explicitly imports a class named "String" from another package
        const map = getImportMap(`
            import com.custom.String;
            class Foo {}
        `);
        expect(resolveTypeName('String', map)).toBe('com.custom.String');
    });
});

describe('JAVA_LANG_TYPES', () => {
    it('should contain commonly used types', () => {
        expect(JAVA_LANG_TYPES.has('String')).toBe(true);
        expect(JAVA_LANG_TYPES.has('Object')).toBe(true);
        expect(JAVA_LANG_TYPES.has('Integer')).toBe(true);
        expect(JAVA_LANG_TYPES.has('Exception')).toBe(true);
        expect(JAVA_LANG_TYPES.has('StringBuilder')).toBe(true);
        expect(JAVA_LANG_TYPES.has('Thread')).toBe(true);
        expect(JAVA_LANG_TYPES.has('Runnable')).toBe(true);
        expect(JAVA_LANG_TYPES.has('Override')).toBe(true);
        expect(JAVA_LANG_TYPES.has('Deprecated')).toBe(true);
        expect(JAVA_LANG_TYPES.has('FunctionalInterface')).toBe(true);
    });

    it('should not contain types from other packages', () => {
        expect(JAVA_LANG_TYPES.has('List')).toBe(false);
        expect(JAVA_LANG_TYPES.has('Map')).toBe(false);
        expect(JAVA_LANG_TYPES.has('ArrayList')).toBe(false);
    });
});
