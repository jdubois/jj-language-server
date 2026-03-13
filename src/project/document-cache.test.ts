/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentCache } from './document-cache.js';
import type { ParseResult } from '../java/parser.js';
import type { SymbolTable } from '../java/symbol-table.js';

function makeParseResult(hasErrors = false): ParseResult {
    return {
        cst: undefined,
        errors: hasErrors ? [{ message: 'err', token: {} as any, ruleStack: [] }] : [],
    };
}

function makeSymbolTable(): SymbolTable {
    return { symbols: [], allSymbols: [] };
}

describe('DocumentCache', () => {
    let cache: DocumentCache;

    beforeEach(() => {
        cache = new DocumentCache();
    });

    afterEach(() => {
        cache.clear();
    });

    it('should return undefined for unknown URI', () => {
        expect(cache.get('file:///unknown.java')).toBeUndefined();
    });

    it('should store and retrieve a document', () => {
        const uri = 'file:///test/Foo.java';
        const pr = makeParseResult();
        const st = makeSymbolTable();

        cache.update(uri, 1, 'class Foo {}', pr, st);

        const cached = cache.get(uri);
        expect(cached).toBeDefined();
        expect(cached!.uri).toBe(uri);
        expect(cached!.version).toBe(1);
        expect(cached!.content).toBe('class Foo {}');
        expect(cached!.isDirty).toBe(false);
    });

    it('should return cached document when version matches', () => {
        const uri = 'file:///test/Foo.java';
        cache.update(uri, 3, 'class Foo {}', makeParseResult(), makeSymbolTable());

        expect(cache.get(uri, 3)).toBeDefined();
        expect(cache.get(uri, 3)!.version).toBe(3);
    });

    it('should return undefined when version does not match', () => {
        const uri = 'file:///test/Foo.java';
        cache.update(uri, 3, 'class Foo {}', makeParseResult(), makeSymbolTable());

        expect(cache.get(uri, 5)).toBeUndefined();
    });

    it('should return cached document when no version is specified', () => {
        const uri = 'file:///test/Foo.java';
        cache.update(uri, 3, 'class Foo {}', makeParseResult(), makeSymbolTable());

        expect(cache.get(uri)).toBeDefined();
    });

    it('should update existing document with new version', () => {
        const uri = 'file:///test/Foo.java';
        cache.update(uri, 1, 'class Foo {}', makeParseResult(), makeSymbolTable());
        cache.update(uri, 2, 'class Foo { int x; }', makeParseResult(), makeSymbolTable());

        const cached = cache.get(uri);
        expect(cached!.version).toBe(2);
        expect(cached!.content).toBe('class Foo { int x; }');
    });

    it('should return false when content and version have not changed', () => {
        const uri = 'file:///test/Foo.java';
        const pr = makeParseResult();
        const st = makeSymbolTable();

        const first = cache.update(uri, 1, 'class Foo {}', pr, st);
        const second = cache.update(uri, 1, 'class Foo {}', pr, st);

        expect(first).toBe(true);
        expect(second).toBe(false);
    });

    it('should return true when content changes', () => {
        const uri = 'file:///test/Foo.java';

        cache.update(uri, 1, 'class Foo {}', makeParseResult(), makeSymbolTable());
        const changed = cache.update(uri, 2, 'class Bar {}', makeParseResult(), makeSymbolTable());

        expect(changed).toBe(true);
    });

    it('should mark a document as dirty', () => {
        const uri = 'file:///test/Foo.java';
        cache.update(uri, 1, 'class Foo {}', makeParseResult(), makeSymbolTable());

        cache.markDirty(uri);

        expect(cache.get(uri)!.isDirty).toBe(true);
    });

    it('should not throw when marking unknown URI as dirty', () => {
        expect(() => cache.markDirty('file:///unknown.java')).not.toThrow();
    });

    it('should remove a document from the cache', () => {
        const uri = 'file:///test/Foo.java';
        cache.update(uri, 1, 'class Foo {}', makeParseResult(), makeSymbolTable());

        cache.remove(uri);

        expect(cache.get(uri)).toBeUndefined();
        expect(cache.size).toBe(0);
    });

    it('should return all cached URIs', () => {
        cache.update('file:///a.java', 1, 'a', makeParseResult(), makeSymbolTable());
        cache.update('file:///b.java', 1, 'b', makeParseResult(), makeSymbolTable());

        const uris = cache.getUris();
        expect(uris).toHaveLength(2);
        expect(uris).toContain('file:///a.java');
        expect(uris).toContain('file:///b.java');
    });

    it('should report correct cache size', () => {
        expect(cache.size).toBe(0);

        cache.update('file:///a.java', 1, 'a', makeParseResult(), makeSymbolTable());
        expect(cache.size).toBe(1);

        cache.update('file:///b.java', 1, 'b', makeParseResult(), makeSymbolTable());
        expect(cache.size).toBe(2);
    });

    it('should clear the entire cache', () => {
        cache.update('file:///a.java', 1, 'a', makeParseResult(), makeSymbolTable());
        cache.update('file:///b.java', 1, 'b', makeParseResult(), makeSymbolTable());

        cache.clear();

        expect(cache.size).toBe(0);
        expect(cache.get('file:///a.java')).toBeUndefined();
    });

    describe('scheduleReparse', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should invoke parseFn after delay', () => {
            const uri = 'file:///test/Foo.java';
            cache.update(uri, 1, 'old', makeParseResult(), makeSymbolTable());

            const parseFn = vi.fn().mockReturnValue({
                parseResult: makeParseResult(),
                symbolTable: makeSymbolTable(),
            });

            cache.scheduleReparse(uri, 'new content', 200, parseFn);

            expect(parseFn).not.toHaveBeenCalled();
            vi.advanceTimersByTime(200);
            expect(parseFn).toHaveBeenCalledWith('new content');
        });

        it('should cancel previous reparse when scheduling a new one', () => {
            const uri = 'file:///test/Foo.java';
            cache.update(uri, 1, 'old', makeParseResult(), makeSymbolTable());

            const firstParseFn = vi.fn().mockReturnValue({
                parseResult: makeParseResult(),
                symbolTable: makeSymbolTable(),
            });
            const secondParseFn = vi.fn().mockReturnValue({
                parseResult: makeParseResult(),
                symbolTable: makeSymbolTable(),
            });

            cache.scheduleReparse(uri, 'first', 200, firstParseFn);
            cache.scheduleReparse(uri, 'second', 200, secondParseFn);

            vi.advanceTimersByTime(200);

            expect(firstParseFn).not.toHaveBeenCalled();
            expect(secondParseFn).toHaveBeenCalledWith('second');
        });

        it('should cancel reparse via cancelReparse', () => {
            const uri = 'file:///test/Foo.java';
            const parseFn = vi.fn().mockReturnValue({
                parseResult: makeParseResult(),
                symbolTable: makeSymbolTable(),
            });

            cache.scheduleReparse(uri, 'content', 200, parseFn);
            cache.cancelReparse(uri);

            vi.advanceTimersByTime(300);
            expect(parseFn).not.toHaveBeenCalled();
        });
    });
});
