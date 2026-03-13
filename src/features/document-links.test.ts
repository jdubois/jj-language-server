/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { provideDocumentLinks } from './document-links.js';

describe('document-links', () => {
    it('should find HTTP URLs in comments', () => {
        const source = `public class Foo {
    // Visit http://example.com for details
}`;
        const links = provideDocumentLinks(source);
        expect(links).toHaveLength(1);
        expect(links[0].target).toBe('http://example.com');
        expect(links[0].range.start.line).toBe(1);
    });

    it('should find HTTPS URLs in strings', () => {
        const source = `public class Foo {
    String url = "https://example.com/api/v2";
}`;
        const links = provideDocumentLinks(source);
        expect(links).toHaveLength(1);
        expect(links[0].target).toBe('https://example.com/api/v2');
    });

    it('should return empty for code with no URLs', () => {
        const source = `public class Foo {
    int x = 42;
}`;
        const links = provideDocumentLinks(source);
        expect(links).toHaveLength(0);
    });

    it('should handle multiple URLs on different lines', () => {
        const source = `public class Foo {
    // See http://example.com
    // Also https://docs.example.com/guide
    String s = "https://api.example.com";
}`;
        const links = provideDocumentLinks(source);
        expect(links).toHaveLength(3);
        expect(links[0].range.start.line).toBe(1);
        expect(links[1].range.start.line).toBe(2);
        expect(links[2].range.start.line).toBe(3);
    });

    it('should have correct URL range positions', () => {
        const source = `    // http://example.com`;
        const links = provideDocumentLinks(source);
        expect(links).toHaveLength(1);
        expect(links[0].range.start.line).toBe(0);
        expect(links[0].range.start.character).toBe(7);
        expect(links[0].range.end.character).toBe(7 + 'http://example.com'.length);
    });
});
