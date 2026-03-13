/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';

/**
 * Organize imports: sort, remove unused, and group imports.
 */
export function organizeImports(text: string, _uri: string): lsp.TextEdit[] {
    const lines = text.split('\n');

    // Find import block boundaries
    let importStart = -1;
    let importEnd = -1;
    const imports: ImportInfo[] = [];

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('import ')) {
            if (importStart === -1) importStart = i;
            importEnd = i;
            imports.push(parseImportLine(trimmed));
        } else if (importStart !== -1 && trimmed !== '' && !trimmed.startsWith('//')) {
            // End of import block (non-empty, non-comment line after imports)
            break;
        }
    }

    if (imports.length === 0) return [];

    // Detect used identifiers (simple check: does the identifier appear outside imports?)
    const codeAfterImports = lines.slice(importEnd + 1).join('\n');
    const usedImports = imports.filter(imp => {
        if (imp.isStatic) return true; // Don't remove static imports
        if (imp.name.endsWith('*')) return true; // Don't remove wildcard imports
        const simpleName = imp.name.split('.').pop()!;
        return codeAfterImports.includes(simpleName);
    });

    // Remove duplicates
    const seen = new Set<string>();
    const dedupedImports = usedImports.filter(imp => {
        const key = `${imp.isStatic ? 'static:' : ''}${imp.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Sort: static imports first, then regular; within each group, alphabetical
    const staticImports = dedupedImports.filter(i => i.isStatic).sort((a, b) => a.name.localeCompare(b.name));
    const regularImports = dedupedImports.filter(i => !i.isStatic).sort((a, b) => a.name.localeCompare(b.name));

    // Group regular imports by top-level package with blank line between groups
    const grouped = groupImports(regularImports);

    // Build new import block
    const newLines: string[] = [];
    if (staticImports.length > 0) {
        for (const imp of staticImports) {
            newLines.push(`import static ${imp.name};`);
        }
        if (grouped.length > 0) newLines.push('');
    }

    for (let i = 0; i < grouped.length; i++) {
        for (const imp of grouped[i]) {
            newLines.push(`import ${imp.name};`);
        }
        if (i < grouped.length - 1) newLines.push('');
    }

    // Replace the old import block with the new one
    const newText = newLines.join('\n');
    return [
        lsp.TextEdit.replace(
            lsp.Range.create(importStart, 0, importEnd, lines[importEnd].length),
            newText,
        ),
    ];
}

interface ImportInfo {
    isStatic: boolean;
    name: string;
    raw: string;
}

function parseImportLine(line: string): ImportInfo {
    const isStatic = line.includes('static ');
    const name = line
        .replace(/^import\s+/, '')
        .replace(/^static\s+/, '')
        .replace(/\s*;\s*$/, '')
        .trim();
    return { isStatic, name, raw: line };
}

function groupImports(imports: ImportInfo[]): ImportInfo[][] {
    const groups = new Map<string, ImportInfo[]>();
    for (const imp of imports) {
        const topLevel = getTopLevelPackage(imp.name);
        const group = groups.get(topLevel) ?? [];
        group.push(imp);
        groups.set(topLevel, group);
    }

    // Standard ordering: java, javax, then everything else alphabetically
    const result: ImportInfo[][] = [];
    const javaGroup = groups.get('java');
    const javaxGroup = groups.get('javax');
    if (javaGroup) { result.push(javaGroup); groups.delete('java'); }
    if (javaxGroup) { result.push(javaxGroup); groups.delete('javax'); }

    const remaining = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, group] of remaining) {
        result.push(group);
    }

    return result;
}

function getTopLevelPackage(name: string): string {
    const parts = name.split('.');
    return parts[0];
}
