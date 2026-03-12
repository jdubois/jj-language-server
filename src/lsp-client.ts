/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';

export interface LspClient {
    publishDiagnostics(params: lsp.PublishDiagnosticsParams): void;
    showMessage(params: lsp.ShowMessageParams): void;
    logMessage(params: lsp.LogMessageParams): void;
}

export class LspClientImpl implements LspClient {
    constructor(private connection: lsp.Connection) {}

    publishDiagnostics(params: lsp.PublishDiagnosticsParams): void {
        this.connection.sendDiagnostics(params);
    }

    showMessage(params: lsp.ShowMessageParams): void {
        this.connection.sendNotification(lsp.ShowMessageNotification.type, params);
    }

    logMessage(params: lsp.LogMessageParams): void {
        this.connection.sendNotification(lsp.LogMessageNotification.type, params);
    }
}
