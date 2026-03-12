/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

let prettierLoaded: typeof import('prettier') | null = null;
let loadFailed = false;

async function loadPrettier(): Promise<typeof import('prettier') | null> {
    if (prettierLoaded) return prettierLoaded;
    if (loadFailed) return null;
    try {
        prettierLoaded = await import('prettier');
        return prettierLoaded;
    } catch {
        loadFailed = true;
        return null;
    }
}

/**
 * Format a full Java document using Prettier with prettier-plugin-java.
 */
export async function formatDocument(
    document: TextDocument,
    options: lsp.FormattingOptions,
): Promise<lsp.TextEdit[]> {
    const prettier = await loadPrettier();
    if (!prettier) return [];

    const text = document.getText();
    try {
        const formatted = await prettier.format(text, {
            parser: 'java',
            plugins: ['prettier-plugin-java'],
            tabWidth: options.tabSize,
            useTabs: !options.insertSpaces,
        });

        if (formatted === text) return [];

        const fullRange = lsp.Range.create(
            document.positionAt(0),
            document.positionAt(text.length),
        );
        return [lsp.TextEdit.replace(fullRange, formatted)];
    } catch {
        return [];
    }
}

/**
 * Format a range within a Java document.
 * Falls back to formatting the full document since prettier-plugin-java
 * does not support range formatting natively.
 */
export async function formatRange(
    document: TextDocument,
    range: lsp.Range,
    options: lsp.FormattingOptions,
): Promise<lsp.TextEdit[]> {
    // Prettier doesn't support range formatting for Java,
    // so we format the whole document
    return formatDocument(document, options);
}
