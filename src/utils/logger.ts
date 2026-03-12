/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import lsp from 'vscode-languageserver';
import type { LspClient } from '../lsp-client.js';

export interface Logger {
    error(message: string): void;
    warn(message: string): void;
    info(message: string): void;
    log(message: string): void;
}

export class LspClientLogger implements Logger {
    private client: LspClient;
    private level: number;

    constructor(client: LspClient, level: lsp.MessageType) {
        this.client = client;
        this.level = level;
    }

    error(message: string): void {
        if (this.level >= lsp.MessageType.Error) {
            this.client.logMessage({ type: lsp.MessageType.Error, message });
        }
    }

    warn(message: string): void {
        if (this.level >= lsp.MessageType.Warning) {
            this.client.logMessage({ type: lsp.MessageType.Warning, message });
        }
    }

    info(message: string): void {
        if (this.level >= lsp.MessageType.Info) {
            this.client.logMessage({ type: lsp.MessageType.Info, message });
        }
    }

    log(message: string): void {
        if (this.level >= lsp.MessageType.Log) {
            this.client.logMessage({ type: lsp.MessageType.Log, message });
        }
    }
}
