/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { computeFoldingRanges } from './folding-ranges.js';
import { parseJava } from '../java/parser.js';
import lsp from 'vscode-languageserver';

function getFoldingRanges(code: string): lsp.FoldingRange[] {
    const result = parseJava(code);
    if (!result.cst) return [];
    return computeFoldingRanges(result.cst, code);
}

describe('computeFoldingRanges', () => {
    it('should fold a class body', () => {
        const code = `public class Hello {
    int x;
}`;
        const ranges = getFoldingRanges(code);
        const classRange = ranges.find(r => r.startLine === 0 && r.endLine === 2);
        expect(classRange).toBeDefined();
    });

    it('should fold a method body', () => {
        const code = `public class Hello {
    public void foo() {
        int x = 1;
    }
}`;
        const ranges = getFoldingRanges(code);
        // Should have at least a class body fold and a method body fold
        expect(ranges.length).toBeGreaterThanOrEqual(2);
        const methodFold = ranges.find(r => r.startLine === 1 && r.endLine === 3);
        expect(methodFold).toBeDefined();
    });

    it('should fold import groups', () => {
        const code = `import java.util.List;
import java.util.Map;
import java.util.Set;

public class Hello {
}`;
        const ranges = getFoldingRanges(code);
        const importRange = ranges.find(r => r.kind === lsp.FoldingRangeKind.Imports);
        expect(importRange).toBeDefined();
        expect(importRange!.startLine).toBe(0);
        expect(importRange!.endLine).toBe(2);
    });

    it('should not fold a single import', () => {
        const code = `import java.util.List;

public class Hello {
}`;
        const ranges = getFoldingRanges(code);
        const importRange = ranges.find(r => r.kind === lsp.FoldingRangeKind.Imports);
        expect(importRange).toBeUndefined();
    });

    it('should fold multi-line comments', () => {
        const code = `/*
 * This is a comment
 * spanning multiple lines
 */
public class Hello {
}`;
        const ranges = getFoldingRanges(code);
        const commentRange = ranges.find(r => r.kind === lsp.FoldingRangeKind.Comment);
        expect(commentRange).toBeDefined();
        expect(commentRange!.startLine).toBe(0);
        expect(commentRange!.endLine).toBe(3);
    });

    it('should fold javadoc comments', () => {
        const code = `/**
 * Javadoc for class.
 */
public class Hello {
}`;
        const ranges = getFoldingRanges(code);
        const commentRange = ranges.find(r => r.kind === lsp.FoldingRangeKind.Comment);
        expect(commentRange).toBeDefined();
    });

    it('should return empty for empty input', () => {
        const ranges = getFoldingRanges('');
        expect(ranges).toHaveLength(0);
    });
});
