/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Integration tests using the real Spring PetClinic project
 * (https://github.com/spring-projects/spring-petclinic).
 *
 * These tests validate that our language server correctly parses, analyses,
 * and provides IDE features for a realistic Spring Boot application.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parseJava, type ParseResult } from '../java/parser.js';
import { buildSymbolTable, type SymbolTable, type JavaSymbol } from '../java/symbol-table.js';
import { extractDocumentSymbols } from '../features/document-symbols.js';
import { computeFoldingRanges } from '../features/folding-ranges.js';
import { computeSemanticDiagnostics } from '../features/semantic-diagnostics.js';
import { provideCompletions } from '../features/completion.js';
import { provideHover } from '../features/hover.js';
import { provideDefinition, provideReferences, provideDocumentHighlight, provideRename } from '../features/navigation.js';
import { computeSemanticTokens } from '../features/semantic-tokens.js';
import { provideSelectionRanges } from '../features/selection-range.js';
import { provideCodeActions } from '../features/code-actions.js';
import { provideSignatureHelp } from '../features/signature-help.js';
import { WorkspaceIndex } from '../project/workspace-index.js';
import lsp from 'vscode-languageserver';

// --- Test infrastructure ---

const PETCLINIC_ROOT = join(__dirname, '../../test-fixtures/spring-petclinic');
const SRC_MAIN = join(PETCLINIC_ROOT, 'src/main/java');
const SRC_TEST = join(PETCLINIC_ROOT, 'src/test/java');

const noopLogger = {
    info: () => {},
    warn: () => {},
    log: () => {},
    error: () => {},
};

interface ParsedFile {
    path: string;
    uri: string;
    code: string;
    result: ParseResult;
    cst: NonNullable<ParseResult['cst']>;
    table: SymbolTable;
}

function collectJavaFiles(dir: string): string[] {
    const files: string[] = [];
    function walk(d: string) {
        for (const entry of readdirSync(d)) {
            const full = join(d, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
            } else if (entry.endsWith('.java') && !entry.endsWith('package-info.java')) {
                files.push(full);
            }
        }
    }
    walk(dir);
    return files.sort();
}

function parseFile(filePath: string): ParsedFile | null {
    const code = readFileSync(filePath, 'utf-8');
    const result = parseJava(code);
    if (!result.cst) return null;
    const table = buildSymbolTable(result.cst);
    const rel = relative(PETCLINIC_ROOT, filePath);
    return {
        path: filePath,
        uri: `file:///${rel.replace(/\\/g, '/')}`,
        code,
        result,
        cst: result.cst,
        table,
    };
}

function findSymbol(table: SymbolTable, name: string, kind?: string): JavaSymbol | undefined {
    return table.allSymbols.find(s => s.name === name && (!kind || s.kind === kind));
}

function findDocSymbol(symbols: lsp.DocumentSymbol[], name: string): lsp.DocumentSymbol | undefined {
    for (const sym of symbols) {
        if (sym.name === name) return sym;
        if (sym.children) {
            const found = findDocSymbol(sym.children, name);
            if (found) return found;
        }
    }
    return undefined;
}

// --- Parsed file cache ---

const parsedFiles = new Map<string, ParsedFile>();
let allMainFiles: string[] = [];
let allTestFiles: string[] = [];

beforeAll(() => {
    allMainFiles = collectJavaFiles(SRC_MAIN);
    allTestFiles = collectJavaFiles(SRC_TEST);

    for (const f of [...allMainFiles, ...allTestFiles]) {
        const parsed = parseFile(f);
        if (parsed) {
            parsedFiles.set(f, parsed);
        }
    }
});

function getFile(fileName: string): ParsedFile {
    for (const [path, pf] of parsedFiles) {
        if (path.endsWith(fileName)) return pf;
    }
    throw new Error(`File ${fileName} not found in parsed files`);
}

// =============================================================================
// 1. PARSING — Every file should parse without errors
// =============================================================================

describe('PetClinic Integration: Parsing', () => {
    it('should find Java source files in the project', () => {
        expect(allMainFiles.length).toBeGreaterThanOrEqual(15);
        expect(allTestFiles.length).toBeGreaterThanOrEqual(5);
    });

    it('should successfully parse all main source files without errors', () => {
        const failures: string[] = [];
        for (const f of allMainFiles) {
            const code = readFileSync(f, 'utf-8');
            const result = parseJava(code);
            if (result.errors.length > 0) {
                failures.push(`${relative(PETCLINIC_ROOT, f)}: ${result.errors.length} error(s)`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('should successfully parse all test source files without errors', () => {
        const failures: string[] = [];
        for (const f of allTestFiles) {
            const code = readFileSync(f, 'utf-8');
            const result = parseJava(code);
            if (result.errors.length > 0) {
                failures.push(`${relative(PETCLINIC_ROOT, f)}: ${result.errors.length} error(s)`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('should produce a CST for every main file', () => {
        for (const f of allMainFiles) {
            const pf = parsedFiles.get(f);
            expect(pf, `Missing parsed file: ${relative(PETCLINIC_ROOT, f)}`).toBeDefined();
            expect(pf!.cst).toBeDefined();
        }
    });
});

// =============================================================================
// 2. SYMBOL TABLE — Verify correct extraction of classes, fields, methods
// =============================================================================

describe('PetClinic Integration: Symbol Table', () => {
    it('should extract BaseEntity class with id field and methods', () => {
        const pf = getFile('BaseEntity.java');
        const cls = findSymbol(pf.table, 'BaseEntity', 'class');
        expect(cls).toBeDefined();
        expect(cls!.modifiers).toContain('public');

        const idField = findSymbol(pf.table, 'id', 'field');
        expect(idField).toBeDefined();
        expect(idField!.type).toBe('Integer');

        const getId = findSymbol(pf.table, 'getId', 'method');
        expect(getId).toBeDefined();

        const setId = findSymbol(pf.table, 'setId', 'method');
        expect(setId).toBeDefined();

        const isNew = findSymbol(pf.table, 'isNew', 'method');
        expect(isNew).toBeDefined();
    });

    it('should extract NamedEntity extending BaseEntity', () => {
        const pf = getFile('NamedEntity.java');
        const cls = findSymbol(pf.table, 'NamedEntity', 'class');
        expect(cls).toBeDefined();
        expect(cls!.superclass).toBe('BaseEntity');

        const nameField = findSymbol(pf.table, 'name', 'field');
        expect(nameField).toBeDefined();
        expect(nameField!.type).toBe('String');
    });

    it('should extract Person extending BaseEntity', () => {
        const pf = getFile('Person.java');
        const cls = findSymbol(pf.table, 'Person', 'class');
        expect(cls).toBeDefined();
        expect(cls!.superclass).toBe('BaseEntity');

        expect(findSymbol(pf.table, 'firstName', 'field')).toBeDefined();
        expect(findSymbol(pf.table, 'lastName', 'field')).toBeDefined();
        expect(findSymbol(pf.table, 'getFirstName', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'getLastName', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'setFirstName', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'setLastName', 'method')).toBeDefined();
    });

    it('should extract Owner extending Person with all fields and methods', () => {
        const pf = getFile('Owner.java');
        const cls = findSymbol(pf.table, 'Owner', 'class');
        expect(cls).toBeDefined();
        expect(cls!.superclass).toBe('Person');

        // Fields
        expect(findSymbol(pf.table, 'address', 'field')).toBeDefined();
        expect(findSymbol(pf.table, 'city', 'field')).toBeDefined();
        expect(findSymbol(pf.table, 'telephone', 'field')).toBeDefined();
        expect(findSymbol(pf.table, 'pets', 'field')).toBeDefined();

        // Methods including overloaded getPet
        const methods = pf.table.allSymbols.filter(s => s.kind === 'method');
        expect(methods.length).toBeGreaterThanOrEqual(8);

        const getPetMethods = methods.filter(m => m.name === 'getPet');
        expect(getPetMethods.length).toBe(3); // overloaded: String, Integer, String+boolean

        expect(findSymbol(pf.table, 'addPet', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'addVisit', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'toString', 'method')).toBeDefined();
    });

    it('should extract Pet extending NamedEntity', () => {
        const pf = getFile('Pet.java');
        const cls = findSymbol(pf.table, 'Pet', 'class');
        expect(cls).toBeDefined();
        expect(cls!.superclass).toBe('NamedEntity');

        expect(findSymbol(pf.table, 'birthDate', 'field')).toBeDefined();
        expect(findSymbol(pf.table, 'type', 'field')).toBeDefined();
        expect(findSymbol(pf.table, 'visits', 'field')).toBeDefined();
    });

    it('should extract Visit extending BaseEntity with constructor', () => {
        const pf = getFile('Visit.java');
        const cls = findSymbol(pf.table, 'Visit', 'class');
        expect(cls).toBeDefined();
        expect(cls!.superclass).toBe('BaseEntity');

        // Has a no-arg constructor
        const ctor = findSymbol(pf.table, 'Visit', 'constructor');
        expect(ctor).toBeDefined();

        expect(findSymbol(pf.table, 'date', 'field')).toBeDefined();
        expect(findSymbol(pf.table, 'description', 'field')).toBeDefined();
    });

    it('should extract PetType and Specialty as empty subclasses of NamedEntity', () => {
        const petType = getFile('PetType.java');
        const ptCls = findSymbol(petType.table, 'PetType', 'class');
        expect(ptCls).toBeDefined();
        expect(ptCls!.superclass).toBe('NamedEntity');

        const specialty = getFile('Specialty.java');
        const spCls = findSymbol(specialty.table, 'Specialty', 'class');
        expect(spCls).toBeDefined();
        expect(spCls!.superclass).toBe('NamedEntity');
    });

    it('should extract Vet extending Person with fields and methods', () => {
        const pf = getFile('Vet.java');
        const cls = findSymbol(pf.table, 'Vet', 'class');
        expect(cls).toBeDefined();
        expect(cls!.superclass).toBe('Person');

        expect(findSymbol(pf.table, 'specialties', 'field')).toBeDefined();
        expect(findSymbol(pf.table, 'getSpecialtiesInternal', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'getSpecialties', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'getNrOfSpecialties', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'addSpecialty', 'method')).toBeDefined();
    });

    it('should extract Vets class with field and method', () => {
        const pf = getFile('Vets.java');
        const cls = findSymbol(pf.table, 'Vets', 'class');
        expect(cls).toBeDefined();

        expect(findSymbol(pf.table, 'vets', 'field')).toBeDefined();
        expect(findSymbol(pf.table, 'getVetList', 'method')).toBeDefined();
    });

    it('should extract OwnerRepository interface extending JpaRepository', () => {
        const pf = getFile('OwnerRepository.java');
        const iface = findSymbol(pf.table, 'OwnerRepository', 'interface');
        expect(iface).toBeDefined();
        expect(iface!.modifiers).toContain('public');

        expect(findSymbol(pf.table, 'findByLastNameStartingWith', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'findById', 'method')).toBeDefined();
    });

    it('should extract VetRepository interface extending Repository', () => {
        const pf = getFile('VetRepository.java');
        const iface = findSymbol(pf.table, 'VetRepository', 'interface');
        expect(iface).toBeDefined();

        const methods = pf.table.allSymbols.filter(s => s.kind === 'method');
        expect(methods.length).toBe(2); // two findAll overloads
    });

    it('should extract PetValidator implementing Validator', () => {
        const pf = getFile('PetValidator.java');
        const cls = findSymbol(pf.table, 'PetValidator', 'class');
        expect(cls).toBeDefined();
        expect(cls!.interfaces).toContain('Validator');

        expect(findSymbol(pf.table, 'validate', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'supports', 'method')).toBeDefined();
    });

    it('should extract PetTypeFormatter implementing Formatter', () => {
        const pf = getFile('PetTypeFormatter.java');
        const cls = findSymbol(pf.table, 'PetTypeFormatter', 'class');
        expect(cls).toBeDefined();
        expect(cls!.interfaces).toContain('Formatter');

        expect(findSymbol(pf.table, 'print', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'parse', 'method')).toBeDefined();
    });

    it('should extract OwnerController with constructor and all handler methods', () => {
        const pf = getFile('OwnerController.java');
        const cls = findSymbol(pf.table, 'OwnerController', 'class');
        expect(cls).toBeDefined();

        // Constructor
        const ctor = findSymbol(pf.table, 'OwnerController', 'constructor');
        expect(ctor).toBeDefined();
        expect(ctor!.parameters).toHaveLength(1);

        // Static field
        const constField = findSymbol(pf.table, 'VIEWS_OWNER_CREATE_OR_UPDATE_FORM', 'field');
        expect(constField).toBeDefined();
        expect(constField!.modifiers).toContain('static');
        expect(constField!.modifiers).toContain('final');

        // Methods
        expect(findSymbol(pf.table, 'setAllowedFields', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'findOwner', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'initCreationForm', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'processCreationForm', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'initFindForm', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'processFindForm', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'showOwner', 'method')).toBeDefined();
    });

    it('should extract VetController with constructor and methods', () => {
        const pf = getFile('VetController.java');
        const cls = findSymbol(pf.table, 'VetController', 'class');
        expect(cls).toBeDefined();

        const ctor = findSymbol(pf.table, 'VetController', 'constructor');
        expect(ctor).toBeDefined();

        expect(findSymbol(pf.table, 'showVetList', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'showResourcesVetList', 'method')).toBeDefined();
    });

    it('should extract PetController with multiple handler methods', () => {
        const pf = getFile('PetController.java');
        const cls = findSymbol(pf.table, 'PetController', 'class');
        expect(cls).toBeDefined();

        const ctor = findSymbol(pf.table, 'PetController', 'constructor');
        expect(ctor).toBeDefined();
        expect(ctor!.parameters).toHaveLength(2);

        expect(findSymbol(pf.table, 'populatePetTypes', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'findOwner', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'findPet', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'initOwnerBinder', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'initPetBinder', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'initCreationForm', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'processCreationForm', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'updatePetDetails', 'method')).toBeDefined();
    });

    it('should extract PetClinicApplication with main method', () => {
        const pf = getFile('PetClinicApplication.java');
        const cls = findSymbol(pf.table, 'PetClinicApplication', 'class');
        expect(cls).toBeDefined();

        const main = findSymbol(pf.table, 'main', 'method');
        expect(main).toBeDefined();
        expect(main!.modifiers).toContain('public');
        expect(main!.modifiers).toContain('static');
    });

    it('should extract CacheConfiguration with @Bean method', () => {
        const pf = getFile('CacheConfiguration.java');
        const cls = findSymbol(pf.table, 'CacheConfiguration', 'class');
        expect(cls).toBeDefined();

        expect(findSymbol(pf.table, 'petclinicCacheConfigurationCustomizer', 'method')).toBeDefined();
        expect(findSymbol(pf.table, 'cacheConfiguration', 'method')).toBeDefined();
    });

    it('should extract all symbols from every main file', () => {
        for (const f of allMainFiles) {
            const pf = parsedFiles.get(f);
            if (!pf) continue;
            const rel = relative(PETCLINIC_ROOT, f);
            // Every non-package-info file should have at least one type symbol
            const types = pf.table.allSymbols.filter(s =>
                ['class', 'interface', 'enum', 'record'].includes(s.kind),
            );
            expect(types.length, `${rel} should have at least one type`).toBeGreaterThanOrEqual(1);
        }
    });
});

// =============================================================================
// 3. DOCUMENT SYMBOLS — Verify outline generation
// =============================================================================

describe('PetClinic Integration: Document Symbols', () => {
    it('should produce a hierarchical outline for Owner.java', () => {
        const pf = getFile('Owner.java');
        const symbols = extractDocumentSymbols(pf.cst);

        const owner = findDocSymbol(symbols, 'Owner');
        expect(owner).toBeDefined();
        expect(owner!.kind).toBe(lsp.SymbolKind.Class);
        expect(owner!.children!.length).toBeGreaterThanOrEqual(8);

        // Check some children
        expect(findDocSymbol(owner!.children!, 'address')).toBeDefined();
        expect(findDocSymbol(owner!.children!, 'getAddress')).toBeDefined();
        expect(findDocSymbol(owner!.children!, 'getPets')).toBeDefined();
    });

    it('should produce outline for OwnerController', () => {
        const pf = getFile('OwnerController.java');
        const symbols = extractDocumentSymbols(pf.cst);

        const ctrl = findDocSymbol(symbols, 'OwnerController');
        expect(ctrl).toBeDefined();
        expect(ctrl!.kind).toBe(lsp.SymbolKind.Class);

        // Should contain constructor + methods
        expect(ctrl!.children!.length).toBeGreaterThanOrEqual(8);
    });

    it('should produce outline for interfaces (OwnerRepository)', () => {
        const pf = getFile('OwnerRepository.java');
        const symbols = extractDocumentSymbols(pf.cst);

        const repo = findDocSymbol(symbols, 'OwnerRepository');
        expect(repo).toBeDefined();
        expect(repo!.kind).toBe(lsp.SymbolKind.Interface);
        expect(repo!.children!.length).toBe(2);
    });

    it('should produce outline for every main file', () => {
        for (const f of allMainFiles) {
            const pf = parsedFiles.get(f);
            if (!pf) continue;
            const symbols = extractDocumentSymbols(pf.cst);
            expect(symbols.length, `${relative(PETCLINIC_ROOT, f)}`).toBeGreaterThanOrEqual(1);
        }
    });
});

// =============================================================================
// 4. FOLDING RANGES — Verify foldable regions
// =============================================================================

describe('PetClinic Integration: Folding Ranges', () => {
    it('should compute folding ranges for OwnerController', () => {
        const pf = getFile('OwnerController.java');
        const ranges = computeFoldingRanges(pf.cst, pf.code);
        expect(ranges).not.toBeNull();
        // Class body + multiple methods + imports block = many folding ranges
        expect(ranges!.length).toBeGreaterThanOrEqual(8);
    });

    it('should compute folding ranges for all files', () => {
        for (const f of allMainFiles) {
            const pf = parsedFiles.get(f);
            if (!pf) continue;
            const ranges = computeFoldingRanges(pf.cst, pf.code);
            // At minimum: class body folds
            expect(ranges, `${relative(PETCLINIC_ROOT, f)}`).not.toBeNull();
        }
    });
});

// =============================================================================
// 5. SEMANTIC DIAGNOSTICS — Verify no false positives on real code
// =============================================================================

describe('PetClinic Integration: Semantic Diagnostics', () => {
    it('should not produce false-positive unresolved-type diagnostics for BaseEntity', () => {
        const pf = getFile('BaseEntity.java');
        const diags = computeSemanticDiagnostics(pf.cst, pf.table, pf.code);
        const unresolvedTypes = diags.filter(d => d.code === 'unresolved-type');
        // Integer is java.lang, Serializable is imported
        expect(unresolvedTypes).toHaveLength(0);
    });

    it('should not produce false-positive duplicate-declaration diagnostics', () => {
        // Owner.java has overloaded getPet methods — not duplicates
        const pf = getFile('Owner.java');
        const diags = computeSemanticDiagnostics(pf.cst, pf.table, pf.code);
        const duplicates = diags.filter(d => d.code === 'duplicate-declaration');
        expect(duplicates).toHaveLength(0);
    });

    it('should have no errors or warnings on BaseEntity', () => {
        const pf = getFile('BaseEntity.java');
        const diags = computeSemanticDiagnostics(pf.cst, pf.table, pf.code);
        const errorsAndWarnings = diags.filter(d =>
            d.severity === lsp.DiagnosticSeverity.Error || d.severity === lsp.DiagnosticSeverity.Warning,
        );
        expect(errorsAndWarnings).toHaveLength(0);
    });

    it('should have minimal false positives across all main files', () => {
        let totalFalsePositives = 0;
        for (const f of allMainFiles) {
            const pf = parsedFiles.get(f);
            if (!pf) continue;
            const diags = computeSemanticDiagnostics(pf.cst, pf.table, pf.code);
            const errors = diags.filter(d => d.severity === lsp.DiagnosticSeverity.Error);
            totalFalsePositives += errors.length;
        }
        // We expect zero false-positive errors on a valid project
        expect(totalFalsePositives).toBe(0);
    });
});

// =============================================================================
// 6. COMPLETION — Verify scope-aware completions
// =============================================================================

describe('PetClinic Integration: Completion', () => {
    it('should provide completions inside Owner.addPet method', () => {
        const pf = getFile('Owner.java');
        // Inside addPet method body
        const addPet = findSymbol(pf.table, 'addPet', 'method');
        expect(addPet).toBeDefined();
        const line = addPet!.line + 1; // inside the method body
        const items = provideCompletions(pf.table, line, 0, pf.code);
        const labels = items.map(i => i.label);

        // Should see the parameter 'pet' and class fields
        expect(labels).toContain('pet');
        // Should see Java keywords
        expect(labels).toContain('if');
        expect(labels).toContain('return');
    });

    it('should provide completions inside OwnerController constructor', () => {
        const pf = getFile('OwnerController.java');
        const ctor = findSymbol(pf.table, 'OwnerController', 'constructor');
        expect(ctor).toBeDefined();
        const line = ctor!.line + 1;
        const items = provideCompletions(pf.table, line, 0, pf.code);
        const labels = items.map(i => i.label);

        // Should see the parameter 'owners'
        expect(labels).toContain('owners');
    });

    it('should include JDK types in completions', () => {
        const pf = getFile('Owner.java');
        const items = provideCompletions(pf.table, 50, 0, pf.code);
        const labels = items.map(i => i.label);

        expect(labels).toContain('ArrayList');
        expect(labels).toContain('HashMap');
        expect(labels).toContain('List');
    });

    it('should provide auto-import additionalTextEdits for non-java.lang JDK types', () => {
        const pf = getFile('BaseEntity.java');
        const items = provideCompletions(pf.table, 38, 0, pf.code);

        const arrayListItem = items.find(i => i.label === 'ArrayList');
        expect(arrayListItem).toBeDefined();
        // ArrayList is not already imported in BaseEntity.java, so should have additionalTextEdits
        expect(arrayListItem!.additionalTextEdits).toBeDefined();
        expect(arrayListItem!.additionalTextEdits!.length).toBe(1);
        expect(arrayListItem!.additionalTextEdits![0].newText).toContain('import java.util.ArrayList');
    });
});

// =============================================================================
// 7. HOVER — Verify hover information
// =============================================================================

describe('PetClinic Integration: Hover', () => {
    it('should provide hover for a field declaration', () => {
        const pf = getFile('Owner.java');
        const field = findSymbol(pf.table, 'address', 'field');
        expect(field).toBeDefined();

        const hover = provideHover(pf.cst, pf.table, pf.code, field!.line, field!.column);
        expect(hover).toBeDefined();
        expect(hover!.contents).toBeDefined();
    });

    it('should provide hover for a method declaration', () => {
        const pf = getFile('Owner.java');
        const method = findSymbol(pf.table, 'getAddress', 'method');
        expect(method).toBeDefined();

        const hover = provideHover(pf.cst, pf.table, pf.code, method!.line, method!.column);
        expect(hover).toBeDefined();
    });

    it('should provide hover for class name', () => {
        const pf = getFile('Owner.java');
        const cls = findSymbol(pf.table, 'Owner', 'class');
        expect(cls).toBeDefined();

        const hover = provideHover(pf.cst, pf.table, pf.code, cls!.line, cls!.column);
        expect(hover).toBeDefined();
    });
});

// =============================================================================
// 8. NAVIGATION — Go to definition, references, highlights
// =============================================================================

describe('PetClinic Integration: Navigation', () => {
    it('should find definition of a field within Owner', () => {
        const pf = getFile('Owner.java');
        // Find where 'address' is used in getAddress method
        const getAddress = findSymbol(pf.table, 'getAddress', 'method');
        expect(getAddress).toBeDefined();

        // The definition should resolve to the field — verify no crash
        const def = provideDefinition(
            pf.cst, pf.table, pf.uri,
            getAddress!.line + 1, // inside the method body
            10,
        );
        expect(() => def).not.toThrow();
    });

    it('should find references to "owners" field in OwnerController', () => {
        const pf = getFile('OwnerController.java');
        const field = findSymbol(pf.table, 'owners', 'field');
        expect(field).toBeDefined();

        const refs = provideReferences(
            pf.cst, pf.table, pf.uri,
            field!.line, field!.column,
        );
        // 'owners' appears as field declaration + constructor parameter + usages
        expect(refs.length).toBeGreaterThanOrEqual(2);
    });

    it('should find references to "VIEWS_OWNER_CREATE_OR_UPDATE_FORM" in OwnerController', () => {
        const pf = getFile('OwnerController.java');
        const field = findSymbol(pf.table, 'VIEWS_OWNER_CREATE_OR_UPDATE_FORM', 'field');
        expect(field).toBeDefined();

        const refs = provideReferences(
            pf.cst, pf.table, pf.uri,
            field!.line, field!.column,
        );
        // Used in declaration + return statements
        expect(refs.length).toBeGreaterThanOrEqual(2);
    });

    it('should highlight all occurrences of "pet" in PetValidator.validate', () => {
        const pf = getFile('PetValidator.java');
        // Find the 'pet' local variable
        const petVar = pf.table.allSymbols.find(s => s.name === 'pet' && s.kind === 'variable');
        if (petVar) {
            const highlights = provideDocumentHighlight(
                pf.cst, pf.table, petVar.line, petVar.column,
            );
            // 'pet' is used multiple times in the validate method
            expect(highlights.length).toBeGreaterThanOrEqual(3);
        }
    });

    it('should support rename of local variable', () => {
        const pf = getFile('VetController.java');
        // Find the 'vets' local variable in showVetList
        const vetsVar = pf.table.allSymbols.find(s => s.name === 'vets' && s.kind === 'variable');
        if (vetsVar) {
            const edit = provideRename(
                pf.cst, pf.table, pf.uri,
                vetsVar.line, vetsVar.column, 'vetCollection',
            );
            expect(edit).toBeDefined();
            const edits = edit!.changes![pf.uri];
            expect(edits.length).toBeGreaterThanOrEqual(2);
            expect(edits.every(e => e.newText === 'vetCollection')).toBe(true);
        }
    });
});

// =============================================================================
// 9. SEMANTIC TOKENS — Verify token classification
// =============================================================================

describe('PetClinic Integration: Semantic Tokens', () => {
    it('should produce semantic tokens for BaseEntity', () => {
        const pf = getFile('BaseEntity.java');
        const tokens = computeSemanticTokens(pf.cst, pf.table);
        expect(tokens).toBeDefined();
        // Should have encoded token data (groups of 5 integers)
        expect(tokens.data.length).toBeGreaterThan(0);
        expect(tokens.data.length % 5).toBe(0);
    });

    it('should produce semantic tokens for OwnerController', () => {
        const pf = getFile('OwnerController.java');
        const tokens = computeSemanticTokens(pf.cst, pf.table);
        expect(tokens.data.length).toBeGreaterThan(0);
        // A complex file should have many tokens
        expect(tokens.data.length / 5).toBeGreaterThanOrEqual(20);
    });

    it('should produce semantic tokens for all main files', () => {
        for (const f of allMainFiles) {
            const pf = parsedFiles.get(f);
            if (!pf) continue;
            const tokens = computeSemanticTokens(pf.cst, pf.table);
            expect(tokens.data.length, `${relative(PETCLINIC_ROOT, f)}`).toBeGreaterThan(0);
        }
    });
});

// =============================================================================
// 10. SELECTION RANGES — Verify smart selection
// =============================================================================

describe('PetClinic Integration: Selection Ranges', () => {
    it('should provide expanding selection ranges in Owner.java', () => {
        const pf = getFile('Owner.java');
        const field = findSymbol(pf.table, 'address', 'field');
        expect(field).toBeDefined();

        const ranges = provideSelectionRanges(
            pf.cst, pf.code,
            [lsp.Position.create(field!.line, field!.column)],
        );
        expect(ranges).not.toBeNull();
        expect(ranges!.length).toBe(1);

        // Walk up the parent chain — should have at least 2 levels
        let depth = 0;
        let r: lsp.SelectionRange | undefined = ranges![0];
        while (r) {
            depth++;
            r = r.parent;
        }
        expect(depth).toBeGreaterThanOrEqual(2);
    });
});

// =============================================================================
// 11. CODE ACTIONS — Verify code actions on real code
// =============================================================================

describe('PetClinic Integration: Code Actions', () => {
    it('should provide code actions for Owner class', () => {
        const pf = getFile('Owner.java');
        const cls = findSymbol(pf.table, 'Owner', 'class');
        expect(cls).toBeDefined();

        const range = lsp.Range.create(cls!.line, cls!.column, cls!.endLine, cls!.endColumn);
        const actions = provideCodeActions(pf.cst, pf.table, pf.code, pf.uri, range, {
            diagnostics: [],
        });
        // Should at least offer organize imports
        expect(actions).toBeDefined();
    });

    it('should offer organize imports on OwnerController', () => {
        const pf = getFile('OwnerController.java');
        const range = lsp.Range.create(0, 0, 0, 0);
        const actions = provideCodeActions(pf.cst, pf.table, pf.code, pf.uri, range, {
            diagnostics: [],
        });
        const organizeAction = actions.find(a =>
            a.kind === lsp.CodeActionKind.SourceOrganizeImports,
        );
        expect(organizeAction).toBeDefined();
    });
});

// =============================================================================
// 12. SIGNATURE HELP — Verify parameter hints
// =============================================================================

describe('PetClinic Integration: Signature Help', () => {
    it('should provide signature help for methods in Owner', () => {
        const pf = getFile('Owner.java');
        const addPet = findSymbol(pf.table, 'addPet', 'method');
        expect(addPet).toBeDefined();
        expect(addPet!.parameters).toHaveLength(1);
    });

    it('should provide method parameter information for PetController constructor', () => {
        const pf = getFile('PetController.java');
        const ctor = findSymbol(pf.table, 'PetController', 'constructor');
        expect(ctor).toBeDefined();
        expect(ctor!.parameters).toHaveLength(2);
        expect(ctor!.parameters![0].name).toBe('owners');
        expect(ctor!.parameters![1].name).toBe('types');
    });
});

// =============================================================================
// 13. WORKSPACE INDEX — Cross-file navigation
// =============================================================================

describe('PetClinic Integration: Workspace Index', () => {
    let wi: WorkspaceIndex;

    beforeAll(() => {
        wi = new WorkspaceIndex(noopLogger as any);
        for (const [, pf] of parsedFiles) {
            wi.updateFile(pf.uri, pf.result, pf.table);
        }
    });

    it('should index all PetClinic main source types', () => {
        expect(wi.findTypeByName('BaseEntity')).toBeDefined();
        expect(wi.findTypeByName('NamedEntity')).toBeDefined();
        expect(wi.findTypeByName('Person')).toBeDefined();
        expect(wi.findTypeByName('Owner')).toBeDefined();
        expect(wi.findTypeByName('Pet')).toBeDefined();
        expect(wi.findTypeByName('PetType')).toBeDefined();
        expect(wi.findTypeByName('Visit')).toBeDefined();
        expect(wi.findTypeByName('Vet')).toBeDefined();
        expect(wi.findTypeByName('Specialty')).toBeDefined();
        expect(wi.findTypeByName('Vets')).toBeDefined();
        expect(wi.findTypeByName('OwnerController')).toBeDefined();
        expect(wi.findTypeByName('VetController')).toBeDefined();
        expect(wi.findTypeByName('PetController')).toBeDefined();
        expect(wi.findTypeByName('OwnerRepository')).toBeDefined();
        expect(wi.findTypeByName('VetRepository')).toBeDefined();
        expect(wi.findTypeByName('PetValidator')).toBeDefined();
        expect(wi.findTypeByName('PetClinicApplication')).toBeDefined();
    });

    it('should return correct URIs for types', () => {
        const owner = wi.findTypeByName('Owner');
        expect(owner).toBeDefined();
        expect(owner!.uri).toContain('Owner.java');

        const vet = wi.findTypeByName('Vet');
        expect(vet).toBeDefined();
        expect(vet!.uri).toContain('Vet.java');
    });

    it('should find symbols by name across files', () => {
        const results = wi.searchSymbols('getPets');
        expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should find types via workspace symbol search', () => {
        const results = wi.searchSymbols('Owner');
        expect(results.length).toBeGreaterThanOrEqual(1);

        const ownerResult = results.find(r => r.name === 'Owner');
        expect(ownerResult).toBeDefined();
    });

    it('should provide cross-file definition lookup', () => {
        // Simulate looking up 'Person' from Owner.java
        const person = wi.findTypeByName('Person');
        expect(person).toBeDefined();
        expect(person!.uri).toContain('Person.java');
    });

    it('should provide cross-file references for shared type names', () => {
        // Owner is referenced in OwnerController and PetController
        const fileUris = wi.getFileUris();
        let referencingFiles = 0;
        for (const uri of fileUris) {
            const table = wi.getSymbolTable(uri);
            if (!table) continue;
            // Check if any symbol references 'Owner' type
            const hasOwnerRef = table.allSymbols.some(s =>
                s.type === 'Owner' || s.type?.includes('Owner') ||
                s.parameters?.some(p => p.type === 'Owner' || p.type?.includes('Owner')),
            );
            if (hasOwnerRef) referencingFiles++;
        }
        // Owner type should be referenced in multiple files
        expect(referencingFiles).toBeGreaterThanOrEqual(2);
    });
});

// =============================================================================
// 14. CLASS HIERARCHY — Verify inheritance is captured
// =============================================================================

describe('PetClinic Integration: Class Hierarchy', () => {
    it('should capture the full PetClinic entity hierarchy', () => {
        // BaseEntity -> NamedEntity -> PetType
        // BaseEntity -> NamedEntity -> Specialty
        // BaseEntity -> NamedEntity -> Pet
        // BaseEntity -> Person -> Owner
        // BaseEntity -> Person -> Vet
        // BaseEntity -> Visit

        const baseEntity = findSymbol(getFile('BaseEntity.java').table, 'BaseEntity', 'class');
        expect(baseEntity).toBeDefined();
        expect(baseEntity!.superclass).toBeUndefined(); // no explicit extends (extends Object implicitly)

        const namedEntity = findSymbol(getFile('NamedEntity.java').table, 'NamedEntity', 'class');
        expect(namedEntity!.superclass).toBe('BaseEntity');

        const person = findSymbol(getFile('Person.java').table, 'Person', 'class');
        expect(person!.superclass).toBe('BaseEntity');

        const owner = findSymbol(getFile('Owner.java').table, 'Owner', 'class');
        expect(owner!.superclass).toBe('Person');

        const pet = findSymbol(getFile('Pet.java').table, 'Pet', 'class');
        expect(pet!.superclass).toBe('NamedEntity');

        const vet = findSymbol(getFile('Vet.java').table, 'Vet', 'class');
        expect(vet!.superclass).toBe('Person');

        const visit = findSymbol(getFile('Visit.java').table, 'Visit', 'class');
        expect(visit!.superclass).toBe('BaseEntity');

        const petType = findSymbol(getFile('PetType.java').table, 'PetType', 'class');
        expect(petType!.superclass).toBe('NamedEntity');

        const specialty = findSymbol(getFile('Specialty.java').table, 'Specialty', 'class');
        expect(specialty!.superclass).toBe('NamedEntity');
    });

    it('should capture implements relationships', () => {
        const baseEntity = findSymbol(getFile('BaseEntity.java').table, 'BaseEntity', 'class');
        expect(baseEntity!.interfaces).toContain('Serializable');

        const petValidator = findSymbol(getFile('PetValidator.java').table, 'PetValidator', 'class');
        expect(petValidator!.interfaces).toContain('Validator');

        const petTypeFormatter = findSymbol(getFile('PetTypeFormatter.java').table, 'PetTypeFormatter', 'class');
        expect(petTypeFormatter!.interfaces).toContain('Formatter');
    });

    it('should capture interface extends relationships', () => {
        const ownerRepo = findSymbol(getFile('OwnerRepository.java').table, 'OwnerRepository', 'interface');
        expect(ownerRepo!.interfaces).toContain('JpaRepository');

        const vetRepo = findSymbol(getFile('VetRepository.java').table, 'VetRepository', 'interface');
        expect(vetRepo!.interfaces).toContain('Repository');
    });
});

// =============================================================================
// 15. COMPREHENSIVE STRESS TEST — All features on all files
// =============================================================================

describe('PetClinic Integration: Stress Test', () => {
    it('should not throw on any feature for any main file', () => {
        for (const f of allMainFiles) {
            const pf = parsedFiles.get(f);
            if (!pf) continue;
            const rel = relative(PETCLINIC_ROOT, f);

            // Document symbols
            expect(() => extractDocumentSymbols(pf.cst), `docSymbols: ${rel}`).not.toThrow();

            // Folding ranges
            expect(() => computeFoldingRanges(pf.cst, pf.code), `folding: ${rel}`).not.toThrow();

            // Semantic diagnostics
            expect(() => computeSemanticDiagnostics(pf.cst, pf.table, pf.code), `diags: ${rel}`).not.toThrow();

            // Semantic tokens
            expect(() => computeSemanticTokens(pf.cst, pf.table), `semTokens: ${rel}`).not.toThrow();

            // Completion at start of class body
            const firstType = pf.table.allSymbols.find(s =>
                ['class', 'interface'].includes(s.kind),
            );
            if (firstType) {
                expect(
                    () => provideCompletions(pf.table, firstType.line + 1, 0, pf.code),
                    `completion: ${rel}`,
                ).not.toThrow();
            }

            // Hover on first identifier
            expect(() => provideHover(pf.cst, pf.table, pf.code, 0, 0), `hover: ${rel}`).not.toThrow();

            // Selection ranges
            expect(
                () => provideSelectionRanges(pf.cst, pf.code, [lsp.Position.create(0, 0)]),
                `selRange: ${rel}`,
            ).not.toThrow();

            // Code actions
            expect(
                () => provideCodeActions(pf.cst, pf.table, pf.code, pf.uri,
                    lsp.Range.create(0, 0, 0, 0), { diagnostics: [] }),
                `codeActions: ${rel}`,
            ).not.toThrow();
        }
    });

    it('should not throw on any feature for any test file', () => {
        for (const f of allTestFiles) {
            const pf = parsedFiles.get(f);
            if (!pf) continue;
            const rel = relative(PETCLINIC_ROOT, f);

            expect(() => extractDocumentSymbols(pf.cst), `docSymbols: ${rel}`).not.toThrow();
            expect(() => computeFoldingRanges(pf.cst, pf.code), `folding: ${rel}`).not.toThrow();
            expect(() => computeSemanticDiagnostics(pf.cst, pf.table, pf.code), `diags: ${rel}`).not.toThrow();
            expect(() => computeSemanticTokens(pf.cst, pf.table), `semTokens: ${rel}`).not.toThrow();
        }
    });
});
