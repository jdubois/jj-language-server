/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import type { CstNode } from 'chevrotain';
import { parseJava } from './parser.js';
import { isCstNode } from './cst-utils.js';
import type { JavaSymbol } from './symbol-table.js';
import {
    extractAnnotations,
    processAnnotations,
    isSpringBean,
    isSpringEndpoint,
    getSpringEndpointInfo,
} from './annotation-processor.js';
import type { AnnotationInfo, GeneratedSymbol } from './annotation-processor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse Java code and return the top-level classDeclaration CST node. */
function getClassNode(code: string): CstNode {
    const result = parseJava(code);
    if (!result.cst) throw new Error('Parse failed');
    const ord = result.cst.children['ordinaryCompilationUnit'];
    if (!Array.isArray(ord)) throw new Error('No ordinaryCompilationUnit');
    const ordNode = ord[0] as CstNode;
    const typeDecls = ordNode.children['typeDeclaration'];
    if (!Array.isArray(typeDecls)) throw new Error('No typeDeclaration');
    const typeDecl = typeDecls[0] as CstNode;
    const classDecls = typeDecl.children['classDeclaration'];
    if (!Array.isArray(classDecls)) throw new Error('No classDeclaration');
    return classDecls[0] as CstNode;
}

/** Find the first fieldDeclaration CST node inside a classDeclaration. */
function getFieldNode(classNode: CstNode, index: number): CstNode {
    const ncd = classNode.children['normalClassDeclaration'];
    if (!Array.isArray(ncd)) throw new Error('No normalClassDeclaration');
    const body = (ncd[0] as CstNode).children['classBody'];
    if (!Array.isArray(body)) throw new Error('No classBody');
    const bodyDecls = (body[0] as CstNode).children['classBodyDeclaration'];
    if (!Array.isArray(bodyDecls)) throw new Error('No classBodyDeclaration');
    const member = (bodyDecls[index] as CstNode).children['classMemberDeclaration'];
    if (!Array.isArray(member)) throw new Error('No classMemberDeclaration');
    const field = (member[0] as CstNode).children['fieldDeclaration'];
    if (!Array.isArray(field)) throw new Error('No fieldDeclaration');
    return field[0] as CstNode;
}

/** Create a minimal JavaSymbol for testing processAnnotations. */
function makeSymbol(overrides: Partial<JavaSymbol> & { name: string; kind: JavaSymbol['kind'] }): JavaSymbol {
    return {
        line: 0,
        column: 0,
        endLine: 0,
        endColumn: 0,
        modifiers: [],
        children: [],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// extractAnnotations
// ---------------------------------------------------------------------------

describe('extractAnnotations', () => {
    it('should extract class-level annotations', () => {
        const classNode = getClassNode(`
            @Data
            public class Foo {
                private String name;
            }
        `);
        const annotations = extractAnnotations(classNode);
        expect(annotations).toHaveLength(1);
        expect(annotations[0].name).toBe('Data');
        expect(annotations[0].target).toBe('class');
    });

    it('should extract multiple class-level annotations', () => {
        const classNode = getClassNode(`
            @Getter
            @Setter
            @ToString
            public class Bar {
                private int x;
            }
        `);
        const annotations = extractAnnotations(classNode);
        const names = annotations.map(a => a.name);
        expect(names).toContain('Getter');
        expect(names).toContain('Setter');
        expect(names).toContain('ToString');
        expect(annotations.every(a => a.target === 'class')).toBe(true);
    });

    it('should extract field-level annotations', () => {
        const classNode = getClassNode(`
            public class Baz {
                @Getter
                private String name;
                private int age;
            }
        `);
        const fieldNode = getFieldNode(classNode, 0);
        const annotations = extractAnnotations(fieldNode);
        expect(annotations).toHaveLength(1);
        expect(annotations[0].name).toBe('Getter');
        expect(annotations[0].target).toBe('field');
    });
});

// ---------------------------------------------------------------------------
// processAnnotations — Lombok @Data
// ---------------------------------------------------------------------------

describe('processAnnotations — @Data', () => {
    const classSymbol = makeSymbol({ name: 'User', kind: 'class', modifiers: ['public'] });
    const fields: JavaSymbol[] = [
        makeSymbol({ name: 'name', kind: 'field', type: 'String', modifiers: ['private'] }),
        makeSymbol({ name: 'age', kind: 'field', type: 'int', modifiers: ['private'] }),
        makeSymbol({ name: 'active', kind: 'field', type: 'boolean', modifiers: ['private'] }),
    ];
    const annotations: AnnotationInfo[] = [{ name: 'Data', target: 'class' }];

    it('should generate getters for all fields', () => {
        const result = processAnnotations(classSymbol, annotations, fields);
        const getters = result.filter(s => s.name.startsWith('get') || s.name.startsWith('is'));
        expect(getters).toHaveLength(3);
        expect(getters.find(g => g.name === 'getName')).toBeDefined();
        expect(getters.find(g => g.name === 'getAge')).toBeDefined();
        expect(getters.find(g => g.name === 'isActive')).toBeDefined();
    });

    it('should generate setters for all fields', () => {
        const result = processAnnotations(classSymbol, annotations, fields);
        const setters = result.filter(s => s.name.startsWith('set'));
        expect(setters).toHaveLength(3);
        expect(setters.find(s => s.name === 'setName')).toBeDefined();
        expect(setters.find(s => s.name === 'setAge')).toBeDefined();
        expect(setters.find(s => s.name === 'setActive')).toBeDefined();
    });

    it('should generate toString, equals, and hashCode', () => {
        const result = processAnnotations(classSymbol, annotations, fields);
        expect(result.find(s => s.name === 'toString')).toBeDefined();
        expect(result.find(s => s.name === 'equals')).toBeDefined();
        expect(result.find(s => s.name === 'hashCode')).toBeDefined();
    });

    it('should generate requiredArgsConstructor with final fields only', () => {
        const fieldsWithFinal: JavaSymbol[] = [
            makeSymbol({ name: 'id', kind: 'field', type: 'Long', modifiers: ['private', 'final'] }),
            makeSymbol({ name: 'name', kind: 'field', type: 'String', modifiers: ['private'] }),
        ];
        const result = processAnnotations(classSymbol, [{ name: 'Data', target: 'class' }], fieldsWithFinal);
        const ctors = result.filter(s => s.kind === 'constructor');
        expect(ctors).toHaveLength(1);
        expect(ctors[0].parameters).toHaveLength(1);
        expect(ctors[0].parameters![0].name).toBe('id');
    });

    it('should mark all generated symbols with isGenerated and generatedBy', () => {
        const result = processAnnotations(classSymbol, annotations, fields);
        for (const sym of result) {
            expect(sym.isGenerated).toBe(true);
            expect(sym.generatedBy).toBe('Data');
        }
    });
});

// ---------------------------------------------------------------------------
// processAnnotations — @Getter / @Setter
// ---------------------------------------------------------------------------

describe('processAnnotations — @Getter/@Setter', () => {
    const classSymbol = makeSymbol({ name: 'Item', kind: 'class', modifiers: ['public'] });
    const fields: JavaSymbol[] = [
        makeSymbol({ name: 'title', kind: 'field', type: 'String', modifiers: ['private'] }),
        makeSymbol({ name: 'count', kind: 'field', type: 'int', modifiers: ['private'] }),
    ];

    it('should generate getters for all fields on class-level @Getter', () => {
        const result = processAnnotations(classSymbol, [{ name: 'Getter', target: 'class' }], fields);
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('getTitle');
        expect(result[1].name).toBe('getCount');
    });

    it('should generate setters for all fields on class-level @Setter', () => {
        const result = processAnnotations(classSymbol, [{ name: 'Setter', target: 'class' }], fields);
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('setTitle');
        expect(result[1].name).toBe('setCount');
    });

    it('should generate getter for a single field on field-level @Getter', () => {
        const singleField = [fields[0]];
        const result = processAnnotations(classSymbol, [{ name: 'Getter', target: 'field' }], singleField);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('getTitle');
        expect(result[0].type).toBe('String');
    });

    it('should generate setter for a single field on field-level @Setter', () => {
        const singleField = [fields[1]];
        const result = processAnnotations(classSymbol, [{ name: 'Setter', target: 'field' }], singleField);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('setCount');
        expect(result[0].parameters).toEqual([{ name: 'count', type: 'int' }]);
    });

    it('should use "is" prefix for boolean getters', () => {
        const boolField = [makeSymbol({ name: 'visible', kind: 'field', type: 'boolean', modifiers: ['private'] })];
        const result = processAnnotations(classSymbol, [{ name: 'Getter', target: 'field' }], boolField);
        expect(result[0].name).toBe('isVisible');
    });
});

// ---------------------------------------------------------------------------
// processAnnotations — @Builder
// ---------------------------------------------------------------------------

describe('processAnnotations — @Builder', () => {
    const classSymbol = makeSymbol({ name: 'Config', kind: 'class', modifiers: ['public'] });

    it('should generate builder() method and Builder inner class', () => {
        const result = processAnnotations(classSymbol, [{ name: 'Builder', target: 'class' }], []);
        expect(result).toHaveLength(2);

        const builderMethod = result.find(s => s.name === 'builder' && s.kind === 'method');
        expect(builderMethod).toBeDefined();
        expect(builderMethod!.modifiers).toContain('static');
        expect(builderMethod!.type).toBe('Config.Builder');

        const builderClass = result.find(s => s.name === 'Builder' && s.kind === 'class');
        expect(builderClass).toBeDefined();
        expect(builderClass!.modifiers).toContain('static');
    });
});

// ---------------------------------------------------------------------------
// processAnnotations — @Slf4j / @Log / @Log4j2 / @CommonsLog
// ---------------------------------------------------------------------------

describe('processAnnotations — logging annotations', () => {
    const classSymbol = makeSymbol({ name: 'App', kind: 'class', modifiers: ['public'] });

    it('should generate log field for @Slf4j', () => {
        const result = processAnnotations(classSymbol, [{ name: 'Slf4j', target: 'class' }], []);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('log');
        expect(result[0].kind).toBe('field');
        expect(result[0].type).toBe('org.slf4j.Logger');
        expect(result[0].modifiers).toEqual(['private', 'static', 'final']);
    });

    it('should generate log field for @Log', () => {
        const result = processAnnotations(classSymbol, [{ name: 'Log', target: 'class' }], []);
        expect(result[0].type).toBe('java.util.logging.Logger');
    });

    it('should generate log field for @Log4j2', () => {
        const result = processAnnotations(classSymbol, [{ name: 'Log4j2', target: 'class' }], []);
        expect(result[0].type).toBe('org.apache.logging.log4j.Logger');
    });

    it('should generate log field for @CommonsLog', () => {
        const result = processAnnotations(classSymbol, [{ name: 'CommonsLog', target: 'class' }], []);
        expect(result[0].type).toBe('org.apache.commons.logging.Log');
    });
});

// ---------------------------------------------------------------------------
// processAnnotations — constructors
// ---------------------------------------------------------------------------

describe('processAnnotations — constructors', () => {
    const classSymbol = makeSymbol({ name: 'Entity', kind: 'class', modifiers: ['public'] });
    const fields: JavaSymbol[] = [
        makeSymbol({ name: 'id', kind: 'field', type: 'Long', modifiers: ['private', 'final'] }),
        makeSymbol({ name: 'name', kind: 'field', type: 'String', modifiers: ['private'] }),
        makeSymbol({ name: 'age', kind: 'field', type: 'int', modifiers: ['private'] }),
    ];

    it('should generate no-args constructor for @NoArgsConstructor', () => {
        const result = processAnnotations(
            classSymbol,
            [{ name: 'NoArgsConstructor', target: 'class' }],
            fields,
        );
        expect(result).toHaveLength(1);
        expect(result[0].kind).toBe('constructor');
        expect(result[0].parameters).toEqual([]);
    });

    it('should generate all-args constructor for @AllArgsConstructor', () => {
        const result = processAnnotations(
            classSymbol,
            [{ name: 'AllArgsConstructor', target: 'class' }],
            fields,
        );
        expect(result).toHaveLength(1);
        expect(result[0].kind).toBe('constructor');
        expect(result[0].parameters).toHaveLength(3);
        expect(result[0].parameters![0]).toEqual({ name: 'id', type: 'Long' });
    });

    it('should generate required-args constructor for @RequiredArgsConstructor (final fields only)', () => {
        const result = processAnnotations(
            classSymbol,
            [{ name: 'RequiredArgsConstructor', target: 'class' }],
            fields,
        );
        expect(result).toHaveLength(1);
        expect(result[0].parameters).toHaveLength(1);
        expect(result[0].parameters![0]).toEqual({ name: 'id', type: 'Long' });
    });
});

// ---------------------------------------------------------------------------
// processAnnotations — @Value
// ---------------------------------------------------------------------------

describe('processAnnotations — @Value', () => {
    const classSymbol = makeSymbol({ name: 'Point', kind: 'class', modifiers: ['public'] });
    const fields: JavaSymbol[] = [
        makeSymbol({ name: 'x', kind: 'field', type: 'int', modifiers: ['private'] }),
        makeSymbol({ name: 'y', kind: 'field', type: 'int', modifiers: ['private'] }),
    ];

    it('should generate getters but not setters', () => {
        const result = processAnnotations(classSymbol, [{ name: 'Value', target: 'class' }], fields);
        const getters = result.filter(s => s.name.startsWith('get'));
        const setters = result.filter(s => s.name.startsWith('set'));
        expect(getters).toHaveLength(2);
        expect(setters).toHaveLength(0);
    });

    it('should generate all-args constructor', () => {
        const result = processAnnotations(classSymbol, [{ name: 'Value', target: 'class' }], fields);
        const ctor = result.find(s => s.kind === 'constructor');
        expect(ctor).toBeDefined();
        expect(ctor!.parameters).toHaveLength(2);
    });

    it('should generate toString, equals, hashCode', () => {
        const result = processAnnotations(classSymbol, [{ name: 'Value', target: 'class' }], fields);
        expect(result.find(s => s.name === 'toString')).toBeDefined();
        expect(result.find(s => s.name === 'equals')).toBeDefined();
        expect(result.find(s => s.name === 'hashCode')).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// isSpringBean
// ---------------------------------------------------------------------------

describe('isSpringBean', () => {
    it('should return true for @Component', () => {
        expect(isSpringBean([{ name: 'Component', target: 'class' }])).toBe(true);
    });

    it('should return true for @Service', () => {
        expect(isSpringBean([{ name: 'Service', target: 'class' }])).toBe(true);
    });

    it('should return true for @Repository', () => {
        expect(isSpringBean([{ name: 'Repository', target: 'class' }])).toBe(true);
    });

    it('should return true for @Controller', () => {
        expect(isSpringBean([{ name: 'Controller', target: 'class' }])).toBe(true);
    });

    it('should return true for @RestController', () => {
        expect(isSpringBean([{ name: 'RestController', target: 'class' }])).toBe(true);
    });

    it('should return true for @Configuration', () => {
        expect(isSpringBean([{ name: 'Configuration', target: 'class' }])).toBe(true);
    });

    it('should return true for @SpringBootApplication', () => {
        expect(isSpringBean([{ name: 'SpringBootApplication', target: 'class' }])).toBe(true);
    });

    it('should return false for non-bean annotations', () => {
        expect(isSpringBean([{ name: 'Data', target: 'class' }])).toBe(false);
    });

    it('should return false for empty annotations', () => {
        expect(isSpringBean([])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// isSpringEndpoint
// ---------------------------------------------------------------------------

describe('isSpringEndpoint', () => {
    it('should detect @GetMapping', () => {
        const result = isSpringEndpoint([{ name: 'GetMapping', target: 'method' }]);
        expect(result).not.toBeNull();
        expect(result!.method).toBe('GET');
    });

    it('should detect @PostMapping', () => {
        const result = isSpringEndpoint([{ name: 'PostMapping', target: 'method' }]);
        expect(result).not.toBeNull();
        expect(result!.method).toBe('POST');
    });

    it('should detect @PutMapping', () => {
        const result = isSpringEndpoint([{ name: 'PutMapping', target: 'method' }]);
        expect(result!.method).toBe('PUT');
    });

    it('should detect @DeleteMapping', () => {
        const result = isSpringEndpoint([{ name: 'DeleteMapping', target: 'method' }]);
        expect(result!.method).toBe('DELETE');
    });

    it('should detect @PatchMapping', () => {
        const result = isSpringEndpoint([{ name: 'PatchMapping', target: 'method' }]);
        expect(result!.method).toBe('PATCH');
    });

    it('should detect @RequestMapping', () => {
        const result = isSpringEndpoint([{ name: 'RequestMapping', target: 'method' }]);
        expect(result!.method).toBe('REQUEST');
    });

    it('should return null for non-endpoint annotations', () => {
        expect(isSpringEndpoint([{ name: 'Service', target: 'class' }])).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getSpringEndpointInfo
// ---------------------------------------------------------------------------

describe('getSpringEndpointInfo', () => {
    it('should return httpMethod and path for @GetMapping', () => {
        const result = getSpringEndpointInfo([{ name: 'GetMapping', target: 'method' }]);
        expect(result).not.toBeNull();
        expect(result!.httpMethod).toBe('GET');
        expect(result!.path).toBe('');
    });

    it('should return null for non-endpoint annotations', () => {
        expect(getSpringEndpointInfo([{ name: 'Autowired', target: 'field' }])).toBeNull();
    });
});
