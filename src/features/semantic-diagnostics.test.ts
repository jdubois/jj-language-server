/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { computeSemanticDiagnostics } from './semantic-diagnostics.js';
import { parseJava } from '../java/parser.js';
import { buildSymbolTable } from '../java/symbol-table.js';

function getDiagnostics(code: string) {
    const result = parseJava(code);
    if (!result.cst) return [];
    const table = buildSymbolTable(result.cst);
    return computeSemanticDiagnostics(result.cst, table, code);
}

function getDiagnosticCodes(code: string): string[] {
    return getDiagnostics(code).map(d => d.code as string).filter(Boolean);
}

describe('semantic diagnostics', () => {
    describe('unresolved types', () => {
        it('should not flag java.lang types', () => {
            const code = `public class App {
    private String name;
    private Object obj;
    private Integer count;
}`;
            const codes = getDiagnosticCodes(code);
            expect(codes.filter(c => c === 'unresolved-type')).toHaveLength(0);
        });

        it('should not flag locally declared types', () => {
            const code = `public class App {
    private App self;
}`;
            const codes = getDiagnosticCodes(code);
            expect(codes.filter(c => c === 'unresolved-type')).toHaveLength(0);
        });

        it('should not flag imported types', () => {
            const code = `import java.util.List;

public class App {
    private List items;
}`;
            const codes = getDiagnosticCodes(code);
            expect(codes.filter(c => c === 'unresolved-type')).toHaveLength(0);
        });

        it('should flag unknown types', () => {
            const code = `public class App {
    private UnknownType field;
}`;
            const diags = getDiagnostics(code);
            const unresolved = diags.filter(d => d.code === 'unresolved-type');
            expect(unresolved.length).toBeGreaterThanOrEqual(1);
            expect(unresolved[0].message).toContain('UnknownType');
        });

        it('should not flag single-letter type parameters', () => {
            const code = `public class Container<T> {
    private T value;
}`;
            const diags = getDiagnostics(code);
            const unresolved = diags.filter(d => d.code === 'unresolved-type');
            expect(unresolved).toHaveLength(0);
        });
    });

    describe('duplicate declarations', () => {
        it('should detect duplicate fields', () => {
            const code = `public class App {
    private int count;
    private String count;
}`;
            const diags = getDiagnostics(code);
            const dupes = diags.filter(d => d.code === 'duplicate-declaration');
            expect(dupes.length).toBeGreaterThanOrEqual(1);
            expect(dupes[0].message).toContain('count');
        });

        it('should allow method overloading (different param count)', () => {
            const code = `public class App {
    public void run() {}
    public void run(String arg) {}
}`;
            const diags = getDiagnostics(code);
            const dupes = diags.filter(d => d.code === 'duplicate-declaration');
            expect(dupes).toHaveLength(0);
        });

        it('should detect truly duplicate methods (same name and same param types)', () => {
            const code = `public class App {
    public void run(String a) {}
    public void run(String b) {}
}`;
            const diags = getDiagnostics(code);
            const dupes = diags.filter(d => d.code === 'duplicate-declaration');
            expect(dupes.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('unused imports', () => {
        it('should flag unused imports', () => {
            const code = `import java.util.List;
import java.util.Map;

public class App {
    private List items;
}`;
            const diags = getDiagnostics(code);
            const unused = diags.filter(d => d.code === 'unused-import');
            expect(unused).toHaveLength(1);
            expect(unused[0].message).toContain('Map');
        });

        it('should not flag wildcard imports', () => {
            const code = `import java.util.*;

public class App {
    private String name;
}`;
            const diags = getDiagnostics(code);
            const unused = diags.filter(d => d.code === 'unused-import');
            expect(unused).toHaveLength(0);
        });

        it('should not flag used imports', () => {
            const code = `import java.util.List;

public class App {
    private List items;
}`;
            const diags = getDiagnostics(code);
            const unused = diags.filter(d => d.code === 'unused-import');
            expect(unused).toHaveLength(0);
        });
    });

    describe('missing return', () => {
        it('should flag methods missing return', () => {
            const code = `public class App {
    public int getValue() {
    }
}`;
            const diags = getDiagnostics(code);
            const missing = diags.filter(d => d.code === 'missing-return');
            expect(missing.length).toBeGreaterThanOrEqual(1);
            expect(missing[0].message).toContain('getValue');
        });

        it('should not flag void methods', () => {
            const code = `public class App {
    public void run() {
    }
}`;
            const diags = getDiagnostics(code);
            const missing = diags.filter(d => d.code === 'missing-return');
            expect(missing).toHaveLength(0);
        });

        it('should not flag methods with return', () => {
            const code = `public class App {
    public int getValue() {
        return 42;
    }
}`;
            const diags = getDiagnostics(code);
            const missing = diags.filter(d => d.code === 'missing-return');
            expect(missing).toHaveLength(0);
        });

        it('should not flag methods with throw', () => {
            const code = `public class App {
    public int getValue() {
        throw new RuntimeException();
    }
}`;
            const diags = getDiagnostics(code);
            const missing = diags.filter(d => d.code === 'missing-return');
            expect(missing).toHaveLength(0);
        });
    });

    describe('unreachable code', () => {
        it('should flag code after return', () => {
            const code = `public class App {
    public int getValue() {
        return 42;
        int x = 1;
    }
}`;
            const diags = getDiagnostics(code);
            const unreachable = diags.filter(d => d.code === 'unreachable-code');
            expect(unreachable.length).toBeGreaterThanOrEqual(1);
        });

        it('should not flag code without early return', () => {
            const code = `public class App {
    public void run() {
        int x = 1;
        int y = 2;
    }
}`;
            const diags = getDiagnostics(code);
            const unreachable = diags.filter(d => d.code === 'unreachable-code');
            expect(unreachable).toHaveLength(0);
        });
    });
});
