/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import lsp from 'vscode-languageserver';
import { createLspConnection } from './lsp-connection.js';

const DEFAULT_LOG_LEVEL = lsp.MessageType.Info;
const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), { encoding: 'utf8' }),
) as { version: string };

const program = new Command('jj-language-server')
    .version(version)
    .requiredOption('--stdio', 'use stdio')
    .option<number>(
        '--log-level <logLevel>',
        'A number indicating the log level (4 = log, 3 = info, 2 = warn, 1 = error). Defaults to `3`.',
        value => parseInt(value, 10),
        3,
    )
    .parse(process.argv);

const options = program.opts<{ logLevel: number }>();

let logLevel: lsp.MessageType = DEFAULT_LOG_LEVEL;
if (options.logLevel >= 1 && options.logLevel <= 4) {
    logLevel = options.logLevel as lsp.MessageType;
} else {
    console.error(`Invalid '--log-level ${options.logLevel}'. Falling back to 'info' level.`);
}

createLspConnection({
    showMessageLevel: logLevel,
}).listen();
