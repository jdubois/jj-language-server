/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { CstNode, IToken } from 'chevrotain';
import type { JavaSymbol } from './symbol-table.js';
import { isCstNode } from './cst-utils.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface AnnotationInfo {
    /** Simple name, e.g. "Data" */
    name: string;
    /** Fully-qualified name, e.g. "lombok.Data" */
    qualifiedName?: string;
    /** What kind of element the annotation was found on */
    target: 'class' | 'field' | 'method' | 'parameter';
}

export interface GeneratedSymbol {
    name: string;
    kind: JavaSymbol['kind'];
    type?: string;
    modifiers: string[];
    parameters?: { name: string; type: string }[];
    isGenerated: true;
    generatedBy: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODIFIER_KEYS: { key: string; target: AnnotationInfo['target'] }[] = [
    { key: 'classModifier', target: 'class' },
    { key: 'interfaceModifier', target: 'class' },
    { key: 'fieldModifier', target: 'field' },
    { key: 'methodModifier', target: 'method' },
    { key: 'constructorModifier', target: 'method' },
    { key: 'interfaceMethodModifier', target: 'method' },
];

const SPRING_BEAN_ANNOTATIONS = new Set([
    'Component',
    'Service',
    'Repository',
    'Controller',
    'RestController',
    'Configuration',
    'SpringBootApplication',
]);

const ENDPOINT_ANNOTATION_TO_METHOD: Record<string, string> = {
    RequestMapping: 'REQUEST',
    GetMapping: 'GET',
    PostMapping: 'POST',
    PutMapping: 'PUT',
    DeleteMapping: 'DELETE',
    PatchMapping: 'PATCH',
};

const LOGGING_ANNOTATION_TYPES: Record<string, string> = {
    Slf4j: 'org.slf4j.Logger',
    Log: 'java.util.logging.Logger',
    Log4j2: 'org.apache.logging.log4j.Logger',
    CommonsLog: 'org.apache.commons.logging.Log',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function generateGetter(field: JavaSymbol, annotationName: string): GeneratedSymbol {
    const isBoolean = field.type === 'boolean';
    const prefix = isBoolean ? 'is' : 'get';
    return {
        name: `${prefix}${capitalize(field.name)}`,
        kind: 'method',
        type: field.type,
        modifiers: ['public'],
        isGenerated: true,
        generatedBy: annotationName,
    };
}

function generateSetter(field: JavaSymbol, annotationName: string): GeneratedSymbol {
    return {
        name: `set${capitalize(field.name)}`,
        kind: 'method',
        type: 'void',
        modifiers: ['public'],
        parameters: [{ name: field.name, type: field.type ?? 'Object' }],
        isGenerated: true,
        generatedBy: annotationName,
    };
}

function generateGetters(fields: JavaSymbol[], annotationName: string): GeneratedSymbol[] {
    return fields.map(f => generateGetter(f, annotationName));
}

function generateSetters(fields: JavaSymbol[], annotationName: string): GeneratedSymbol[] {
    return fields.map(f => generateSetter(f, annotationName));
}

function generateToString(className: string, annotationName: string): GeneratedSymbol {
    return {
        name: 'toString',
        kind: 'method',
        type: 'String',
        modifiers: ['public'],
        isGenerated: true,
        generatedBy: annotationName,
    };
}

function generateEquals(annotationName: string): GeneratedSymbol {
    return {
        name: 'equals',
        kind: 'method',
        type: 'boolean',
        modifiers: ['public'],
        parameters: [{ name: 'o', type: 'Object' }],
        isGenerated: true,
        generatedBy: annotationName,
    };
}

function generateHashCode(annotationName: string): GeneratedSymbol {
    return {
        name: 'hashCode',
        kind: 'method',
        type: 'int',
        modifiers: ['public'],
        isGenerated: true,
        generatedBy: annotationName,
    };
}

function generateConstructor(
    className: string,
    params: { name: string; type: string }[],
    annotationName: string,
): GeneratedSymbol {
    return {
        name: className,
        kind: 'constructor',
        modifiers: ['public'],
        parameters: params,
        isGenerated: true,
        generatedBy: annotationName,
    };
}

function isFinalField(field: JavaSymbol): boolean {
    return field.modifiers.includes('final');
}

/**
 * Read the simple annotation name from a CST annotation node.
 *
 * CST shape:  annotation → At, typeName → Identifier+
 */
function readAnnotationName(annotationNode: CstNode): string | undefined {
    const typeNameNodes = annotationNode.children['typeName'];
    if (!Array.isArray(typeNameNodes) || typeNameNodes.length === 0) return undefined;

    const typeName = typeNameNodes[0];
    if (!isCstNode(typeName)) return undefined;

    const identifiers = typeName.children['Identifier'];
    if (!Array.isArray(identifiers) || identifiers.length === 0) return undefined;

    const lastId = identifiers[identifiers.length - 1];
    if (isCstNode(lastId)) return undefined;
    return (lastId as IToken).image;
}

/**
 * Build a qualified annotation name from the CST when there are multiple
 * Identifier tokens (e.g. `lombok.Data`).  Returns `undefined` when the
 * annotation is not qualified.
 */
function readQualifiedName(annotationNode: CstNode): string | undefined {
    const typeNameNodes = annotationNode.children['typeName'];
    if (!Array.isArray(typeNameNodes) || typeNameNodes.length === 0) return undefined;

    const typeName = typeNameNodes[0];
    if (!isCstNode(typeName)) return undefined;

    const identifiers = typeName.children['Identifier'];
    if (!Array.isArray(identifiers) || identifiers.length < 2) return undefined;

    const parts: string[] = [];
    for (const id of identifiers) {
        if (!isCstNode(id)) {
            parts.push((id as IToken).image);
        }
    }
    return parts.length > 1 ? parts.join('.') : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract annotations from a class / field / method CST node by inspecting
 * its modifier children.
 */
export function extractAnnotations(node: CstNode): AnnotationInfo[] {
    const annotations: AnnotationInfo[] = [];

    for (const { key, target } of MODIFIER_KEYS) {
        const modifiers = node.children[key];
        if (!Array.isArray(modifiers)) continue;

        for (const mod of modifiers) {
            if (!isCstNode(mod)) continue;
            const annotationNodes = mod.children['annotation'];
            if (!Array.isArray(annotationNodes)) continue;

            for (const ann of annotationNodes) {
                if (!isCstNode(ann)) continue;
                const name = readAnnotationName(ann);
                if (name) {
                    annotations.push({
                        name,
                        qualifiedName: readQualifiedName(ann),
                        target,
                    });
                }
            }
        }
    }

    return annotations;
}

/**
 * Generate virtual symbols for a class based on its Lombok annotations.
 *
 * The caller controls scope by which `fields` are passed in:
 * - Class-level annotation  → pass all class fields
 * - Field-level annotation  → pass only the annotated field
 */
export function processAnnotations(
    classSymbol: JavaSymbol,
    annotations: AnnotationInfo[],
    fields: JavaSymbol[],
): GeneratedSymbol[] {
    const generated: GeneratedSymbol[] = [];
    const seen = new Set<string>();

    for (const ann of annotations) {
        switch (ann.name) {
            case 'Data': {
                generated.push(...generateGetters(fields, 'Data'));
                generated.push(...generateSetters(fields, 'Data'));
                generated.push(generateToString(classSymbol.name, 'Data'));
                generated.push(generateEquals('Data'));
                generated.push(generateHashCode('Data'));
                const finalFields = fields.filter(isFinalField);
                const params = finalFields.map(f => ({ name: f.name, type: f.type ?? 'Object' }));
                generated.push(generateConstructor(classSymbol.name, params, 'Data'));
                break;
            }

            case 'Value': {
                // Like @Data but all fields are treated as final — getters only, no setters
                generated.push(...generateGetters(fields, 'Value'));
                generated.push(generateToString(classSymbol.name, 'Value'));
                generated.push(generateEquals('Value'));
                generated.push(generateHashCode('Value'));
                const allParams = fields.map(f => ({ name: f.name, type: f.type ?? 'Object' }));
                generated.push(generateConstructor(classSymbol.name, allParams, 'Value'));
                break;
            }

            case 'Getter':
                generated.push(...generateGetters(fields, 'Getter'));
                break;

            case 'Setter':
                generated.push(...generateSetters(fields, 'Setter'));
                break;

            case 'ToString':
                if (!seen.has('toString')) {
                    generated.push(generateToString(classSymbol.name, 'ToString'));
                    seen.add('toString');
                }
                break;

            case 'EqualsAndHashCode':
                if (!seen.has('equals')) {
                    generated.push(generateEquals('EqualsAndHashCode'));
                    generated.push(generateHashCode('EqualsAndHashCode'));
                    seen.add('equals');
                }
                break;

            case 'NoArgsConstructor':
                generated.push(generateConstructor(classSymbol.name, [], 'NoArgsConstructor'));
                break;

            case 'AllArgsConstructor': {
                const params = fields.map(f => ({ name: f.name, type: f.type ?? 'Object' }));
                generated.push(generateConstructor(classSymbol.name, params, 'AllArgsConstructor'));
                break;
            }

            case 'RequiredArgsConstructor': {
                const finalFields = fields.filter(isFinalField);
                const params = finalFields.map(f => ({ name: f.name, type: f.type ?? 'Object' }));
                generated.push(generateConstructor(classSymbol.name, params, 'RequiredArgsConstructor'));
                break;
            }

            case 'Builder': {
                // builder() static factory method
                generated.push({
                    name: 'builder',
                    kind: 'method',
                    type: `${classSymbol.name}.Builder`,
                    modifiers: ['public', 'static'],
                    isGenerated: true,
                    generatedBy: 'Builder',
                });
                // Inner Builder class
                generated.push({
                    name: 'Builder',
                    kind: 'class',
                    modifiers: ['public', 'static'],
                    isGenerated: true,
                    generatedBy: 'Builder',
                });
                break;
            }

            case 'Slf4j':
            case 'Log':
            case 'Log4j2':
            case 'CommonsLog': {
                if (!seen.has('log')) {
                    generated.push({
                        name: 'log',
                        kind: 'field',
                        type: LOGGING_ANNOTATION_TYPES[ann.name],
                        modifiers: ['private', 'static', 'final'],
                        isGenerated: true,
                        generatedBy: ann.name,
                    });
                    seen.add('log');
                }
                break;
            }

            default:
                break;
        }
    }

    return generated;
}

/**
 * Check if any of the given annotations mark the class as a Spring bean.
 */
export function isSpringBean(annotations: AnnotationInfo[]): boolean {
    return annotations.some(a => SPRING_BEAN_ANNOTATIONS.has(a.name));
}

/**
 * If the annotations include a Spring endpoint mapping, return the HTTP
 * method (or `null` if the annotations do not describe an endpoint).
 */
export function isSpringEndpoint(
    annotations: AnnotationInfo[],
): { method: string; path?: string } | null {
    for (const ann of annotations) {
        const method = ENDPOINT_ANNOTATION_TO_METHOD[ann.name];
        if (method) {
            return { method };
        }
    }
    return null;
}

/**
 * Return Spring endpoint info (HTTP method + path) when the annotations
 * describe an endpoint.  Path defaults to `""` since annotation values
 * are not parsed from the CST.
 */
export function getSpringEndpointInfo(
    annotations: AnnotationInfo[],
): { httpMethod: string; path: string } | null {
    for (const ann of annotations) {
        const httpMethod = ENDPOINT_ANNOTATION_TO_METHOD[ann.name];
        if (httpMethod) {
            return { httpMethod, path: '' };
        }
    }
    return null;
}
