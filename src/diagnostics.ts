/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { ParseError } from './java/parser.js';

/**
 * Convert parse errors from java-parser into LSP Diagnostic objects.
 */
export function parseErrorsToDiagnostics(errors: ParseError[]): lsp.Diagnostic[] {
    return errors.map(error => {
        const { token } = error;

        // Chevrotain tokens use 1-based lines/columns; LSP uses 0-based
        const startLine = (token.startLine ?? 1) - 1;
        const startChar = (token.startColumn ?? 1) - 1;
        const endLine = (token.endLine ?? token.startLine ?? 1) - 1;
        const endChar = (token.endColumn ?? token.startColumn ?? 1);

        return lsp.Diagnostic.create(
            lsp.Range.create(startLine, startChar, endLine, endChar),
            error.message,
            lsp.DiagnosticSeverity.Error,
            undefined,
            'jj-language-server',
        );
    });
}
