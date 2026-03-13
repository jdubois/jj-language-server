#!/usr/bin/env node
/**
 * LSP Performance Benchmark — jj-language-server vs Eclipse JDTLS
 *
 * Measures: startup time, memory usage, and operation latency for common LSP requests
 * using real Spring PetClinic Java files over JSON-RPC stdio.
 */

import { spawn, execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────────────────
const ROOT = resolve(__dirname, '..');
const PETCLINIC = join(ROOT, 'test-fixtures', 'spring-petclinic');
const JDTLS_BIN = join(ROOT, 'test-fixtures', 'jdtls', 'bin', 'jdtls');
const JJ_BIN = join(ROOT, 'lib', 'cli.mjs');

const WARMUP_RUNS = 1;
const BENCH_RUNS = 3;

// ── Helpers ────────────────────────────────────────────────────────────────

function findJavaFiles(dir) {
    const results = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) results.push(...findJavaFiles(full));
        else if (entry.name.endsWith('.java')) results.push(full);
    }
    return results;
}

function fileUri(p) { return `file://${p}`; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getMemoryMB(pid) {
    try {
        const out = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8' }).trim();
        return parseFloat((parseInt(out, 10) / 1024).toFixed(1));
    } catch { return null; }
}

// ── JSON-RPC client ───────────────────────────────────────────────────────

class LspClient {
    constructor(proc) {
        this.proc = proc;
        this.seq = 1;
        this.pending = new Map();
        this.buffer = '';
        this.headerMode = true;
        this.contentLength = -1;

        proc.stdout.on('data', (chunk) => this._onData(chunk.toString()));
        proc.stderr.on('data', () => {});
    }

    _onData(text) {
        this.buffer += text;
        while (true) {
            if (this.headerMode) {
                const idx = this.buffer.indexOf('\r\n\r\n');
                if (idx === -1) return;
                const header = this.buffer.slice(0, idx);
                const match = header.match(/Content-Length:\s*(\d+)/i);
                if (match) this.contentLength = parseInt(match[1], 10);
                this.buffer = this.buffer.slice(idx + 4);
                this.headerMode = false;
            }
            if (this.contentLength < 0 || this.buffer.length < this.contentLength) return;
            const body = this.buffer.slice(0, this.contentLength);
            this.buffer = this.buffer.slice(this.contentLength);
            this.headerMode = true;
            this.contentLength = -1;
            try {
                const msg = JSON.parse(body);
                if (msg.id != null && this.pending.has(msg.id)) {
                    this.pending.get(msg.id)(msg);
                    this.pending.delete(msg.id);
                }
            } catch { /* ignore parse errors from notifications */ }
        }
    }

    send(method, params, timeoutMs = 120_000) {
        const id = this.seq++;
        const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
        const packet = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;
        this.proc.stdin.write(packet);
        return new Promise((resolve, reject) => {
            this.pending.set(id, resolve);
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`Timeout after ${timeoutMs}ms: ${method}`));
                }
            }, timeoutMs);
        });
    }

    notify(method, params) {
        const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
        const packet = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;
        this.proc.stdin.write(packet);
    }
}

// ── Server launchers ──────────────────────────────────────────────────────

function launchJJ() {
    const proc = spawn('node', [JJ_BIN, '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: PETCLINIC,
    });
    return { proc, client: new LspClient(proc), name: 'jj (Node.js)' };
}

function launchJJBun() {
    // Bun runs TypeScript natively — use the source directly to avoid
    // CJS/ESM compatibility issues with the rollup bundle.
    const srcCli = join(ROOT, 'src', 'cli.ts');
    const proc = spawn('bun', ['run', srcCli, '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: PETCLINIC,
    });
    return { proc, client: new LspClient(proc), name: 'jj (Bun)' };
}

function launchJDTLS() {
    const dataDir = join(ROOT, 'benchmarks', '.jdtls-data');
    const proc = spawn(JDTLS_BIN, ['-data', dataDir], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: PETCLINIC,
    });
    return { proc, client: new LspClient(proc), name: 'Eclipse JDTLS' };
}

// ── Benchmark harness ─────────────────────────────────────────────────────

async function initializeServer(client, rootUri) {
    return await client.send('initialize', {
        processId: process.pid,
        rootUri,
        capabilities: {
            textDocument: {
                completion: { completionItem: { snippetSupport: true } },
                hover: { contentFormat: ['markdown', 'plaintext'] },
                signatureHelp: { signatureInformation: { parameterInformation: { labelOffsetSupport: true } } },
                synchronization: { didSave: true },
                documentSymbol: { hierarchicalDocumentSymbolSupport: true },
                semanticTokens: { requests: { full: true, range: true } },
            },
            workspace: { workspaceFolders: true },
        },
        workspaceFolders: [{ uri: rootUri, name: 'petclinic' }],
    });
}

async function openFile(client, uri, text) {
    client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'java', version: 1, text },
    });
}

async function measureOp(label, fn, runs = BENCH_RUNS) {
    // warmup
    for (let i = 0; i < WARMUP_RUNS; i++) {
        try { await fn(); } catch { /* ignore warmup errors */ }
    }
    const times = [];
    const results = [];
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        let result;
        try { result = await fn(); } catch { /* timeout = skip */ }
        times.push(performance.now() - start);
        results.push(result);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    // Check if responses have content (not null/empty)
    let hasContent = false;
    for (const r of results) {
        if (r?.result != null) {
            if (Array.isArray(r.result)) hasContent = r.result.length > 0;
            else if (typeof r.result === 'object') hasContent = Object.keys(r.result).length > 0;
            else hasContent = true;
        }
    }
    return {
        label,
        avg: Math.round(avg * 10) / 10,
        min: Math.round(Math.min(...times) * 10) / 10,
        max: Math.round(Math.max(...times) * 10) / 10,
        hasContent,
    };
}

// ── Benchmark one server ──────────────────────────────────────────────────

async function benchmarkServer(launchFn, javaFiles, warmupMs) {
    const results = {};
    const rootUri = fileUri(PETCLINIC);

    // 1. Startup time (initialize handshake)
    const t0 = performance.now();
    const { proc, client, name } = launchFn();
    const initResult = await initializeServer(client, rootUri);
    client.notify('initialized', {});
    results.startupMs = Math.round(performance.now() - t0);

    console.log(`    init response received in ${results.startupMs}ms`);

    // Let server warm up (JDTLS does background indexing)
    await sleep(warmupMs);

    // 2. Memory after init
    results.memAfterInitMB = getMemoryMB(proc.pid);

    // Pick representative files
    const sorted = javaFiles
        .map(f => ({ path: f, text: readFileSync(f, 'utf8') }))
        .sort((a, b) => a.text.length - b.text.length);
    const small = sorted[0];
    const medium = sorted[Math.floor(sorted.length / 2)];
    const large = sorted[sorted.length - 1];
    const testFile = large; // benchmark on largest file

    console.log(`    target: ${testFile.path.split('/').pop()} (${testFile.text.split('\n').length} lines)`);

    // Open the target file
    const targetUri = fileUri(testFile.path);
    await openFile(client, targetUri, testFile.text);
    await sleep(warmupMs > 5000 ? 3000 : 500);

    // Find interesting positions for benchmarks
    const lines = testFile.text.split('\n');
    let hoverLine = 10, hoverChar = 5;
    let completionLine = 10, completionChar = 5;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Find a method declaration for hover
        if (hoverLine === 10 && /^\s+(public|private|protected)\s+\w/.test(line) && !line.includes('class ')) {
            hoverLine = i;
            const match = line.match(/\b(\w+)\s*\(/);
            hoverChar = match ? line.indexOf(match[1]) + 1 : 10;
        }
        // Find a dot for completion
        if (completionLine === 10 && line.includes('.') && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*') && !line.includes('import ')) {
            completionLine = i;
            completionChar = line.indexOf('.') + 1;
        }
    }

    // 3. LSP operation benchmarks
    const ops = [];

    ops.push(await measureOp('hover', () =>
        client.send('textDocument/hover', {
            textDocument: { uri: targetUri },
            position: { line: hoverLine, character: hoverChar },
        }, 10_000)
    ));
    process.stdout.write('.');

    ops.push(await measureOp('completion', () =>
        client.send('textDocument/completion', {
            textDocument: { uri: targetUri },
            position: { line: completionLine, character: completionChar },
        }, 10_000)
    ));
    process.stdout.write('.');

    ops.push(await measureOp('documentSymbol', () =>
        client.send('textDocument/documentSymbol', {
            textDocument: { uri: targetUri },
        }, 10_000)
    ));
    process.stdout.write('.');

    ops.push(await measureOp('definition', () =>
        client.send('textDocument/definition', {
            textDocument: { uri: targetUri },
            position: { line: hoverLine, character: hoverChar },
        }, 10_000)
    ));
    process.stdout.write('.');

    ops.push(await measureOp('references', () =>
        client.send('textDocument/references', {
            textDocument: { uri: targetUri },
            position: { line: hoverLine, character: hoverChar },
            context: { includeDeclaration: true },
        }, 10_000)
    ));
    process.stdout.write('.');

    ops.push(await measureOp('formatting', () =>
        client.send('textDocument/formatting', {
            textDocument: { uri: targetUri },
            options: { tabSize: 4, insertSpaces: true },
        }, 10_000)
    ));
    process.stdout.write('.');

    ops.push(await measureOp('codeAction', () =>
        client.send('textDocument/codeAction', {
            textDocument: { uri: targetUri },
            range: { start: { line: hoverLine, character: 0 }, end: { line: hoverLine + 5, character: 0 } },
            context: { diagnostics: [] },
        }, 10_000)
    ));
    process.stdout.write('.');

    ops.push(await measureOp('foldingRange', () =>
        client.send('textDocument/foldingRange', {
            textDocument: { uri: targetUri },
        }, 10_000)
    ));
    process.stdout.write('.');

    ops.push(await measureOp('semanticTokens', () =>
        client.send('textDocument/semanticTokens/full', {
            textDocument: { uri: targetUri },
        }, 10_000)
    ));
    process.stdout.write('.\n');

    results.operations = ops;

    // 4. Bulk open all PetClinic files
    const bulkStart = performance.now();
    for (const f of javaFiles) {
        const text = readFileSync(f, 'utf8');
        client.notify('textDocument/didOpen', {
            textDocument: { uri: fileUri(f), languageId: 'java', version: 1, text },
        });
    }
    await sleep(warmupMs > 5000 ? 5000 : 1500);
    results.bulkOpenMs = Math.round(performance.now() - bulkStart);
    results.bulkOpenFiles = javaFiles.length;

    // 5. Final memory
    results.memFinalMB = getMemoryMB(proc.pid);

    // Shutdown
    try {
        await client.send('shutdown', null, 5000);
        client.notify('exit', null);
    } catch { /* ignore */ }
    await sleep(500);
    proc.kill('SIGTERM');

    return { name, results };
}

// ── Report ────────────────────────────────────────────────────────────────

function formatReport(benchmarks) {
    const sep = '═'.repeat(78);
    const thin = '─'.repeat(78);

    console.log(`\n${sep}`);
    console.log('  LSP Performance Benchmark: jj (Node.js) vs jj (Bun) vs Eclipse JDTLS');
    console.log('  Corpus: Spring PetClinic • ' + new Date().toISOString().slice(0, 10));
    console.log(sep);

    // ── Startup ──
    console.log('\n  ⏱  STARTUP TIME (initialize handshake)\n');
    console.log('  ' + thin);
    const startups = benchmarks.map(b => ({ name: b.name, ms: b.results.startupMs }));
    const fastestStart = Math.min(...startups.map(s => s.ms));
    for (const s of startups) {
        const bar = '█'.repeat(Math.min(50, Math.round(s.ms / fastestStart * 10)));
        const ratio = (s.ms / fastestStart).toFixed(1) + 'x';
        console.log(`  ${s.name.padEnd(22)} ${String(s.ms).padStart(7)} ms  ${ratio.padStart(6)}  ${bar}`);
    }

    // ── Memory ──
    console.log('\n  💾  MEMORY USAGE (RSS)\n');
    console.log('  ' + thin);
    console.log('  ' + 'Server'.padEnd(22) + 'After init'.padStart(12) + 'After files'.padStart(14) + '  Final'.padStart(10));
    console.log('  ' + thin);
    for (const b of benchmarks) {
        const r = b.results;
        const init = r.memAfterInitMB != null ? `${r.memAfterInitMB} MB` : 'N/A';
        const fin = r.memFinalMB != null ? `${r.memFinalMB} MB` : 'N/A';
        console.log(`  ${b.name.padEnd(22)} ${init.padStart(12)} ${''.padStart(14)} ${fin.padStart(10)}`);
    }

    // ── Operations ──
    console.log('\n  ⚡  OPERATION LATENCY (avg of 3 runs, largest PetClinic file)\n');
    console.log('  ' + thin);

    // Build header with all server names
    const colWidth = 16;
    let header = '  ' + 'Operation'.padEnd(18);
    for (const b of benchmarks) {
        header += b.name.padStart(colWidth);
    }
    console.log(header);
    console.log('  ' + thin);

    // Collect all operation labels across benchmarks
    const allLabels = [...new Set(benchmarks.flatMap(b => b.results.operations.map(o => o.label)))];
    const opsMap = benchmarks.map(b => Object.fromEntries(b.results.operations.map(o => [o.label, o])));

    for (const label of allLabels) {
        let line = `  ${label.padEnd(18)}`;
        const values = opsMap.map(m => m[label]);
        const validTimes = values.filter(v => v?.hasContent).map(v => v.avg);
        const fastest = validTimes.length > 0 ? Math.min(...validTimes) : null;

        for (let i = 0; i < benchmarks.length; i++) {
            const op = values[i];
            if (!op) { line += 'N/A'.padStart(colWidth); continue; }
            const q = op.hasContent ? '' : ' (∅)';
            let cell = `${op.avg} ms${q}`;
            if (op.hasContent && fastest != null && op.avg === fastest && validTimes.length > 1) {
                cell = `*${op.avg} ms`;
            }
            line += cell.padStart(colWidth);
        }
        console.log(line);
    }

    // ── Bulk open ──
    console.log('\n  📂  BULK FILE OPEN (all PetClinic .java files)\n');
    console.log('  ' + thin);
    for (const b of benchmarks) {
        console.log(`  ${b.name.padEnd(22)} ${b.results.bulkOpenFiles} files in ${b.results.bulkOpenMs} ms`);
    }

    console.log('\n' + sep);
    console.log('  Notes:');
    console.log('  • jj (Node.js): Node.js runtime, Chevrotain CST parser');
    console.log('  • jj (Bun): Bun runtime, same Chevrotain CST parser');
    console.log('  • Eclipse JDTLS: JVM + Eclipse JDT compiler, full type resolution');
    console.log('  • JDTLS startup includes JVM bootstrap + workspace indexing');
    console.log('  • Memory = RSS (Resident Set Size) as reported by ps');
    console.log('  • (∅) = response was null or empty array (server not ready / unsupported)');
    console.log('  • * = fastest for that operation');
    console.log(sep + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
    const javaFiles = findJavaFiles(join(PETCLINIC, 'src', 'main', 'java'));
    console.log(`\nFound ${javaFiles.length} Java files in Spring PetClinic\n`);

    const args = process.argv.slice(2);
    const jjOnly = args.includes('--jj-only');
    const jdtlsOnly = args.includes('--jdtls-only');
    const bunOnly = args.includes('--bun-only');
    const noBun = args.includes('--no-bun');
    const noJdtls = args.includes('--no-jdtls');

    const benchmarks = [];

    if (!jdtlsOnly && !bunOnly) {
        console.log('▶ Benchmarking jj-language-server (Node.js)...');
        const result = await benchmarkServer(launchJJ, javaFiles, 1000);
        benchmarks.push(result);
        console.log(`  ✔ jj (Node.js) done\n`);
    }

    if (!jdtlsOnly && !jjOnly && !noBun) {
        console.log('▶ Benchmarking jj-language-server (Bun)...');
        try {
            const result = await benchmarkServer(launchJJBun, javaFiles, 1000);
            benchmarks.push(result);
            console.log(`  ✔ jj (Bun) done\n`);
        } catch (err) {
            console.log(`  ✘ jj (Bun) failed: ${err.message}\n`);
        }
    }

    if (!jjOnly && !bunOnly && !noJdtls) {
        console.log('▶ Benchmarking Eclipse JDTLS (slower due to JVM + Maven import)...');
        console.log('  Giving JDTLS 60s warmup for project import...');
        const result = await benchmarkServer(launchJDTLS, javaFiles, 60000);
        benchmarks.push(result);
        console.log(`  ✔ Eclipse JDTLS done\n`);
    }

    formatReport(benchmarks);
}

main().catch(err => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});
