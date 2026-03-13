/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { DocumentLink } from 'vscode-languageserver';

const URL_PATTERN = /https?:\/\/[^\s"'<>}\])]+/g;

/**
 * Finds clickable URLs in comments and strings within the source text.
 */
export function provideDocumentLinks(sourceText: string): DocumentLink[] {
    const links: DocumentLink[] = [];
    const lines = sourceText.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        let match: RegExpExecArray | null;
        URL_PATTERN.lastIndex = 0;

        while ((match = URL_PATTERN.exec(line)) !== null) {
            const url = match[0];
            const startChar = match.index;
            const endChar = startChar + url.length;

            links.push({
                range: {
                    start: { line: lineIndex, character: startChar },
                    end: { line: lineIndex, character: endChar },
                },
                target: url,
            });
        }
    }

    return links;
}
