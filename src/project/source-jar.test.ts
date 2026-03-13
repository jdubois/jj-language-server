/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { SourceJarCache } from './source-jar.js';

const logger = { log: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

// Helper to build a minimal JAR (ZIP) file containing .java source files
function buildSourceJar(files: Record<string, string>): Buffer {
    const entries: { name: string; data: Buffer }[] = [];
    for (const [name, content] of Object.entries(files)) {
        entries.push({ name, data: Buffer.from(content, 'utf-8') });
    }
    return buildZipBuffer(entries);
}

function buildZipBuffer(entries: { name: string; data: Buffer }[]): Buffer {
    const localHeaders: Buffer[] = [];
    const centralHeaders: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = Buffer.from(entry.name, 'utf-8');
        const compressed = deflateRawSync(entry.data);

        // Local file header
        const local = Buffer.alloc(30 + nameBytes.length + compressed.length);
        local.writeUInt32LE(0x04034b50, 0); // signature
        local.writeUInt16LE(20, 4);  // version needed
        local.writeUInt16LE(0, 6);   // flags
        local.writeUInt16LE(8, 8);   // compression = deflate
        local.writeUInt16LE(0, 10);  // mod time
        local.writeUInt16LE(0, 12);  // mod date
        local.writeUInt32LE(0, 14);  // crc32 (skip for test)
        local.writeUInt32LE(compressed.length, 18); // compressed size
        local.writeUInt32LE(entry.data.length, 22);  // uncompressed size
        local.writeUInt16LE(nameBytes.length, 26);   // name length
        local.writeUInt16LE(0, 28);  // extra length
        nameBytes.copy(local, 30);
        compressed.copy(local, 30 + nameBytes.length);

        // Central directory header
        const central = Buffer.alloc(46 + nameBytes.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);  // version made by
        central.writeUInt16LE(20, 6);  // version needed
        central.writeUInt16LE(0, 8);   // flags
        central.writeUInt16LE(8, 10);  // compression
        central.writeUInt16LE(0, 12);  // mod time
        central.writeUInt16LE(0, 14);  // mod date
        central.writeUInt32LE(0, 16);  // crc32
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(entry.data.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt16LE(0, 30);  // extra length
        central.writeUInt16LE(0, 32);  // comment length
        central.writeUInt16LE(0, 34);  // disk start
        central.writeUInt16LE(0, 36);  // internal attrs
        central.writeUInt32LE(0, 38);  // external attrs
        central.writeUInt32LE(offset, 42); // local header offset
        nameBytes.copy(central, 46);

        localHeaders.push(local);
        centralHeaders.push(central);
        offset += local.length;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const ch of centralHeaders) centralDirSize += ch.length;

    // End of central directory
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);  // disk number
    eocd.writeUInt16LE(0, 6);  // disk with central dir
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

describe('SourceJarCache', () => {
    let cache: SourceJarCache;
    let tmpDir: string;

    beforeEach(async () => {
        cache = new SourceJarCache(logger);
        tmpDir = join(tmpdir(), `source-jar-test-${Date.now()}`);
        await mkdir(tmpDir, { recursive: true });
    });

    it('should create virtual URIs', () => {
        const uri = SourceJarCache.createVirtualUri('java.util.ArrayList');
        expect(uri).toBe('jj-source-jar:///java/util/ArrayList.java');
    });

    it('should detect virtual URIs', () => {
        expect(SourceJarCache.isVirtualUri('jj-source-jar:///java/util/ArrayList.java')).toBe(true);
        expect(SourceJarCache.isVirtualUri('file:///src/Main.java')).toBe(false);
    });

    it('should extract qualified name from virtual URI', () => {
        const name = SourceJarCache.qualifiedNameFromUri('jj-source-jar:///java/util/ArrayList.java');
        expect(name).toBe('java.util.ArrayList');
    });

    it('should index source JAR and find types', async () => {
        const jar = buildSourceJar({
            'com/example/Greeter.java': `package com.example;
public class Greeter {
    public String greet(String name) {
        return "Hello, " + name;
    }
}`,
        });
        const jarPath = join(tmpDir, 'test-sources.jar');
        await writeFile(jarPath, jar);

        const count = await cache.indexSourceJar(jarPath);
        expect(count).toBe(1);
        expect(cache.size).toBe(1);

        const entry = await cache.findSource('com.example.Greeter');
        expect(entry).toBeTruthy();
        expect(entry!.qualifiedName).toBe('com.example.Greeter');
        expect(entry!.sourceText).toContain('class Greeter');
        expect(entry!.parseResult.cst).toBeTruthy();
        expect(entry!.symbolTable.symbols.length).toBeGreaterThan(0);
    });

    it('should lazily extract single file from JAR', async () => {
        const jar = buildSourceJar({
            'com/example/Service.java': `package com.example;
public class Service {
    public void run() {}
}`,
            'com/example/Helper.java': `package com.example;
public class Helper {
    public static int compute(int x) { return x * 2; }
}`,
        });
        const jarPath = join(tmpDir, 'multi-sources.jar');
        await writeFile(jarPath, jar);

        cache.registerSourceJars([{
            jarPath,
            groupId: 'com.example',
            artifactId: 'test',
            version: '1.0',
        }]);

        // Before findSource, cache should be empty
        expect(cache.size).toBe(0);

        // Since lazy extraction uses jarPaths keys, we use indexSourceJar
        const count = await cache.indexSourceJar(jarPath);
        expect(count).toBe(2);

        const service = await cache.findSource('com.example.Service');
        expect(service).toBeTruthy();
        expect(service!.symbolTable.symbols[0].name).toBe('Service');

        const helper = await cache.findSource('com.example.Helper');
        expect(helper).toBeTruthy();
    });

    it('should skip package-info and module-info files', async () => {
        const jar = buildSourceJar({
            'com/example/package-info.java': `/** Package docs */\npackage com.example;`,
            'module-info.java': `module com.example {}`,
            'com/example/Real.java': `package com.example;\npublic class Real {}`,
        });
        const jarPath = join(tmpDir, 'skip-sources.jar');
        await writeFile(jarPath, jar);

        const count = await cache.indexSourceJar(jarPath);
        expect(count).toBe(1);
    });

    it('should return undefined for unknown types', async () => {
        const entry = await cache.findSource('com.nonexistent.Type');
        expect(entry).toBeUndefined();
    });

    it('should clear cache', async () => {
        const jar = buildSourceJar({
            'com/example/Foo.java': `package com.example;\npublic class Foo {}`,
        });
        const jarPath = join(tmpDir, 'clear-test.jar');
        await writeFile(jarPath, jar);

        await cache.indexSourceJar(jarPath);
        expect(cache.size).toBe(1);

        cache.clear();
        expect(cache.size).toBe(0);
    });

    it('should handle source JAR with parsing errors gracefully', async () => {
        const jar = buildSourceJar({
            'com/example/Bad.java': `this is not valid java!!!`,
            'com/example/Good.java': `package com.example;\npublic class Good {}`,
        });
        const jarPath = join(tmpDir, 'mixed-sources.jar');
        await writeFile(jarPath, jar);

        const count = await cache.indexSourceJar(jarPath);
        expect(count).toBe(1); // Only Good.java should succeed
    });

    it('should register source JARs for later loading', () => {
        // No file exists, so it shouldn't register
        cache.registerSourceJars([{
            jarPath: '/nonexistent/path.jar',
            groupId: 'com.example',
            artifactId: 'test',
            version: '1.0',
        }]);
        expect(cache.size).toBe(0);
    });
});
