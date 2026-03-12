/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import lsp from 'vscode-languageserver';
import { provideSourceGenerationActions } from './source-generation.js';
import { buildSymbolTable } from '../java/symbol-table.js';
import { parseJava } from '../java/parser.js';

function getActions(code: string, line: number, character: number) {
    const result = parseJava(code);
    if (!result.cst) return [];
    const table = buildSymbolTable(result.cst);
    const range = lsp.Range.create(line, character, line, character);
    return provideSourceGenerationActions(table, code, range, 'file:///test.java');
}

function getActionTitles(code: string, line: number, character: number): string[] {
    return getActions(code, line, character).map(a => a.title);
}

describe('source generation', () => {
    const classWithFields = `public class Person {
    private String name;
    private int age;
}`;

    it('should offer constructor generation', () => {
        const titles = getActionTitles(classWithFields, 1, 0);
        expect(titles).toContain('Generate constructor using all fields');
        expect(titles).toContain('Generate no-args constructor');
    });

    it('should generate constructor with field assignments', () => {
        const actions = getActions(classWithFields, 1, 0);
        const ctorAction = actions.find(a => a.title.includes('constructor using all fields'));
        expect(ctorAction?.edit?.changes).toBeDefined();
        const edits = Object.values(ctorAction!.edit!.changes!)[0];
        expect(edits[0].newText).toContain('public Person(String name, int age)');
        expect(edits[0].newText).toContain('this.name = name');
        expect(edits[0].newText).toContain('this.age = age');
    });

    it('should offer getter/setter generation', () => {
        const titles = getActionTitles(classWithFields, 1, 0);
        expect(titles).toContain('Generate getters');
        expect(titles).toContain('Generate setters');
        expect(titles).toContain('Generate getters and setters');
    });

    it('should generate correct getter names', () => {
        const actions = getActions(classWithFields, 1, 0);
        const getterAction = actions.find(a => a.title === 'Generate getters');
        const edits = Object.values(getterAction!.edit!.changes!)[0];
        expect(edits[0].newText).toContain('getName()');
        expect(edits[0].newText).toContain('getAge()');
    });

    it('should use is prefix for boolean getters', () => {
        const code = `public class Flags {
    private boolean active;
}`;
        const actions = getActions(code, 1, 0);
        const getterAction = actions.find(a => a.title === 'Generate getters');
        const edits = Object.values(getterAction!.edit!.changes!)[0];
        expect(edits[0].newText).toContain('isActive()');
    });

    it('should not generate setters for final fields', () => {
        const code = `public class Immutable {
    private final String id;
    private String name;
}`;
        const actions = getActions(code, 1, 0);
        const setterAction = actions.find(a => a.title === 'Generate setters');
        const edits = Object.values(setterAction!.edit!.changes!)[0];
        expect(edits[0].newText).not.toContain('setId');
        expect(edits[0].newText).toContain('setName');
    });

    it('should offer toString generation', () => {
        const titles = getActionTitles(classWithFields, 1, 0);
        expect(titles).toContain('Generate toString()');
    });

    it('should generate toString with field names', () => {
        const actions = getActions(classWithFields, 1, 0);
        const toStrAction = actions.find(a => a.title === 'Generate toString()');
        const edits = Object.values(toStrAction!.edit!.changes!)[0];
        expect(edits[0].newText).toContain('@Override');
        expect(edits[0].newText).toContain('Person{');
        expect(edits[0].newText).toContain('name=');
        expect(edits[0].newText).toContain('age=');
    });

    it('should offer equals/hashCode generation', () => {
        const titles = getActionTitles(classWithFields, 1, 0);
        expect(titles).toContain('Generate equals() and hashCode()');
    });

    it('should generate equals with proper type checks', () => {
        const actions = getActions(classWithFields, 1, 0);
        const eqAction = actions.find(a => a.title === 'Generate equals() and hashCode()');
        const edits = Object.values(eqAction!.edit!.changes!)[0];
        expect(edits[0].newText).toContain('@Override');
        expect(edits[0].newText).toContain('equals(Object o)');
        expect(edits[0].newText).toContain('Person other');
        expect(edits[0].newText).toContain('hashCode()');
        expect(edits[0].newText).toContain('Objects.hash');
    });

    it('should use == for primitive fields in equals', () => {
        const actions = getActions(classWithFields, 1, 0);
        const eqAction = actions.find(a => a.title === 'Generate equals() and hashCode()');
        const edits = Object.values(eqAction!.edit!.changes!)[0];
        // age is int (primitive) -> should use ==
        expect(edits[0].newText).toContain('this.age == other.age');
        // name is String (object) -> should use Objects.equals
        expect(edits[0].newText).toContain('Objects.equals(this.name, other.name)');
    });

    it('should not offer actions for class without fields', () => {
        const code = `public class Empty {
}`;
        const titles = getActionTitles(code, 0, 14);
        expect(titles).toHaveLength(0);
    });

    it('should not offer constructor if one already exists', () => {
        const code = `public class App {
    private String name;
    public App(String name) {
        this.name = name;
    }
}`;
        const titles = getActionTitles(code, 1, 0);
        expect(titles).not.toContain('Generate constructor using all fields');
    });
});
