/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { organizeImports } from './organize-imports.js';

function applyEdits(text: string, uri = 'file:///test.java') {
    const edits = organizeImports(text, uri);
    if (edits.length === 0) return text;
    const lines = text.split('\n');
    // Apply edits in reverse order to maintain line numbers
    for (const edit of [...edits].reverse()) {
        const start = edit.range.start;
        const end = edit.range.end;
        const before = lines.slice(0, start.line).join('\n');
        const after = lines.slice(end.line + 1).join('\n');
        const parts = [before, edit.newText, after].filter(Boolean);
        return parts.join('\n');
    }
    return text;
}

describe('organize-imports', () => {
    it('sorts imports alphabetically', () => {
        const code = 'import java.util.Map;\nimport java.util.List;\n\npublic class Foo { List l; Map m; }';
        const result = applyEdits(code);
        const importLines = result.split('\n').filter(l => l.startsWith('import'));
        expect(importLines[0]).toBe('import java.util.List;');
        expect(importLines[1]).toBe('import java.util.Map;');
    });

    it('removes duplicate imports', () => {
        const code = 'import java.util.List;\nimport java.util.List;\n\npublic class Foo { List<String> items; }';
        organizeImports(code, 'file:///test.java');
        // After applying edits, the duplicate should be gone
        const result = applyEdits(code);
        const importLines = result.split('\n').filter(l => l.startsWith('import'));
        expect(importLines.length).toBe(1);
    });

    it('groups java/javax imports before others', () => {
        const code = 'import com.example.Bar;\nimport java.util.List;\n\npublic class Foo { List l; Bar b; }';
        const result = applyEdits(code);
        const importLines = result.split('\n').filter(l => l.startsWith('import'));
        expect(importLines[0]).toBe('import java.util.List;');
    });

    it('preserves code after imports', () => {
        const code = 'import java.util.List;\n\npublic class Foo { List<String> items; }';
        const result = applyEdits(code);
        expect(result).toContain('public class Foo');
    });

    it('returns no edits for no imports', () => {
        const code = 'public class Foo {}';
        const edits = organizeImports(code, 'file:///test.java');
        expect(edits).toEqual([]);
    });
});
