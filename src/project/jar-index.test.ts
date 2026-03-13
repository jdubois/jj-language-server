/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JarIndex, parseZipEntries, extractEntry } from './jar-index.js';
import type { IndexedType } from './jar-index.js';
import type { ResolvedDependency } from './classpath-resolver.js';
import type { Logger } from '../utils/logger.js';

// ── Test helpers ───────────────────────────────────────────────────

/** No-op logger for tests. */
function createTestLogger(): Logger {
    return {
        error: () => {},
        warn: () => {},
        info: () => {},
        log: () => {},
    };
}

// ── Minimal class file builder ─────────────────────────────────────

function u1(val: number): Buffer {
    const b = Buffer.alloc(1);
    b.writeUInt8(val);
    return b;
}

function u2(val: number): Buffer {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(val);
    return b;
}

function u4(val: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(val);
    return b;
}

function utf8Cp(str: string): Buffer {
    const strBuf = Buffer.from(str, 'utf8');
    return Buffer.concat([u1(1), u2(strBuf.length), strBuf]);
}

function classRef(nameIndex: number): Buffer {
    return Buffer.concat([u1(7), u2(nameIndex)]);
}

/**
 * Build a minimal valid .class file for a public class.
 *
 * @param internalName e.g. "com/example/Foo"
 */
function buildClassFile(internalName: string): Buffer {
    const parts: Buffer[] = [];
    // CP entries:
    // #1 Utf8 internalName
    // #2 Class #1
    // #3 Utf8 "java/lang/Object"
    // #4 Class #3
    // #5 Utf8 "<init>"
    // #6 Utf8 "()V"
    const cpEntries = [
        utf8Cp(internalName),
        classRef(1),
        utf8Cp('java/lang/Object'),
        classRef(3),
        utf8Cp('<init>'),
        utf8Cp('()V'),
    ];

    parts.push(u4(0xcafebabe));   // magic
    parts.push(u2(0));             // minor version
    parts.push(u2(61));            // major version (Java 17)
    parts.push(u2(cpEntries.length + 1)); // cp count
    for (const entry of cpEntries) parts.push(entry);
    parts.push(u2(0x0001));        // ACC_PUBLIC
    parts.push(u2(2));             // this_class: #2
    parts.push(u2(4));             // super_class: #4
    parts.push(u2(0));             // interfaces count
    parts.push(u2(0));             // fields count
    // 1 method: <init>
    parts.push(u2(1));
    parts.push(u2(0x0001));        // ACC_PUBLIC
    parts.push(u2(5));             // name: #5 "<init>"
    parts.push(u2(6));             // descriptor: #6 "()V"
    parts.push(u2(0));             // attributes count
    // class attributes
    parts.push(u2(0));

    return Buffer.concat(parts);
}

/**
 * Build a minimal .class file for a non-public (package-private) class.
 */
function buildPackagePrivateClassFile(internalName: string): Buffer {
    const parts: Buffer[] = [];
    const cpEntries = [
        utf8Cp(internalName),
        classRef(1),
        utf8Cp('java/lang/Object'),
        classRef(3),
        utf8Cp('<init>'),
        utf8Cp('()V'),
    ];

    parts.push(u4(0xcafebabe));
    parts.push(u2(0));
    parts.push(u2(61));
    parts.push(u2(cpEntries.length + 1));
    for (const entry of cpEntries) parts.push(entry);
    parts.push(u2(0x0000));        // no ACC_PUBLIC
    parts.push(u2(2));
    parts.push(u2(4));
    parts.push(u2(0));
    parts.push(u2(0));
    parts.push(u2(1));
    parts.push(u2(0x0000));
    parts.push(u2(5));
    parts.push(u2(6));
    parts.push(u2(0));
    parts.push(u2(0));

    return Buffer.concat(parts);
}

// ── Minimal ZIP builder ────────────────────────────────────────────

interface ZipFileEntry {
    name: string;
    data: Buffer;
    compress?: boolean;
}

/**
 * Build a minimal ZIP file in memory.
 */
function buildZip(files: ZipFileEntry[]): Buffer {
    const localHeaders: Buffer[] = [];
    const centralEntries: Buffer[] = [];
    let offset = 0;

    for (const file of files) {
        const nameBytes = Buffer.from(file.name, 'utf8');
        const uncompressed = file.data;
        let compressed: Buffer;
        let method: number;

        if (file.compress) {
            compressed = deflateRawSync(uncompressed);
            method = 8;
        } else {
            compressed = uncompressed;
            method = 0;
        }

        // Local file header (30 + nameLen + data)
        const local = Buffer.alloc(30 + nameBytes.length + compressed.length);
        local.writeUInt32LE(0x04034b50, 0);  // signature
        local.writeUInt16LE(20, 4);           // version needed
        local.writeUInt16LE(0, 6);            // flags
        local.writeUInt16LE(method, 8);       // compression
        local.writeUInt16LE(0, 10);           // mod time
        local.writeUInt16LE(0, 12);           // mod date
        local.writeUInt32LE(0, 14);           // crc32 (not validated by our reader)
        local.writeUInt32LE(compressed.length, 18);  // compressed size
        local.writeUInt32LE(uncompressed.length, 22); // uncompressed size
        local.writeUInt16LE(nameBytes.length, 26);   // name length
        local.writeUInt16LE(0, 28);           // extra length
        nameBytes.copy(local, 30);
        compressed.copy(local, 30 + nameBytes.length);

        const localHeaderOffset = offset;
        localHeaders.push(local);
        offset += local.length;

        // Central directory entry (46 + nameLen)
        const cd = Buffer.alloc(46 + nameBytes.length);
        cd.writeUInt32LE(0x02014b50, 0);     // signature
        cd.writeUInt16LE(20, 4);              // version made by
        cd.writeUInt16LE(20, 6);              // version needed
        cd.writeUInt16LE(0, 8);               // flags
        cd.writeUInt16LE(method, 10);         // compression
        cd.writeUInt16LE(0, 12);              // mod time
        cd.writeUInt16LE(0, 14);              // mod date
        cd.writeUInt32LE(0, 16);              // crc32
        cd.writeUInt32LE(compressed.length, 20);     // compressed size
        cd.writeUInt32LE(uncompressed.length, 24);   // uncompressed size
        cd.writeUInt16LE(nameBytes.length, 28);      // name length
        cd.writeUInt16LE(0, 30);              // extra length
        cd.writeUInt16LE(0, 32);              // comment length
        cd.writeUInt16LE(0, 34);              // disk start
        cd.writeUInt16LE(0, 36);              // internal attributes
        cd.writeUInt32LE(0, 38);              // external attributes
        cd.writeUInt32LE(localHeaderOffset, 42); // local header offset
        nameBytes.copy(cd, 46);

        centralEntries.push(cd);
    }

    // Central directory
    const cdOffset = offset;
    let cdSize = 0;
    for (const cd of centralEntries) cdSize += cd.length;

    // End of central directory record (22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);       // signature
    eocd.writeUInt16LE(0, 4);                 // disk number
    eocd.writeUInt16LE(0, 6);                 // disk with CD
    eocd.writeUInt16LE(files.length, 8);      // entries on disk
    eocd.writeUInt16LE(files.length, 10);     // total entries
    eocd.writeUInt32LE(cdSize, 12);           // CD size
    eocd.writeUInt32LE(cdOffset, 16);         // CD offset
    eocd.writeUInt16LE(0, 20);                // comment length

    return Buffer.concat([...localHeaders, ...centralEntries, eocd]);
}

// ── ZIP parsing tests ──────────────────────────────────────────────

describe('ZIP parsing', () => {
    it('should parse an empty ZIP file', () => {
        const zip = buildZip([]);
        const entries = parseZipEntries(zip);
        expect(entries).toHaveLength(0);
    });

    it('should parse ZIP with a stored entry', () => {
        const data = Buffer.from('Hello, world!', 'utf8');
        const zip = buildZip([{ name: 'hello.txt', data, compress: false }]);
        const entries = parseZipEntries(zip);

        expect(entries).toHaveLength(1);
        expect(entries[0].fileName).toBe('hello.txt');
        expect(entries[0].compressionMethod).toBe(0);
        expect(entries[0].uncompressedSize).toBe(data.length);
    });

    it('should parse ZIP with a deflated entry', () => {
        const data = Buffer.from('Compressed content here', 'utf8');
        const zip = buildZip([{ name: 'data.bin', data, compress: true }]);
        const entries = parseZipEntries(zip);

        expect(entries).toHaveLength(1);
        expect(entries[0].fileName).toBe('data.bin');
        expect(entries[0].compressionMethod).toBe(8);
    });

    it('should parse ZIP with multiple entries', () => {
        const zip = buildZip([
            { name: 'a.txt', data: Buffer.from('aaa'), compress: false },
            { name: 'b.txt', data: Buffer.from('bbb'), compress: true },
            { name: 'c.txt', data: Buffer.from('ccc'), compress: false },
        ]);
        const entries = parseZipEntries(zip);

        expect(entries).toHaveLength(3);
        expect(entries.map(e => e.fileName)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    });

    it('should extract stored entry data', () => {
        const data = Buffer.from('stored data', 'utf8');
        const zip = buildZip([{ name: 'test.dat', data, compress: false }]);
        const entries = parseZipEntries(zip);
        const extracted = extractEntry(zip, entries[0]);

        expect(extracted).not.toBeNull();
        expect(extracted!.toString('utf8')).toBe('stored data');
    });

    it('should extract deflated entry data', () => {
        const data = Buffer.from('deflated data content', 'utf8');
        const zip = buildZip([{ name: 'test.dat', data, compress: true }]);
        const entries = parseZipEntries(zip);
        const extracted = extractEntry(zip, entries[0]);

        expect(extracted).not.toBeNull();
        expect(extracted!.toString('utf8')).toBe('deflated data content');
    });

    it('should return null for invalid buffer', () => {
        const entries = parseZipEntries(Buffer.from('not a zip'));
        expect(entries).toHaveLength(0);
    });

    it('should extract .class entry from JAR and parse it', () => {
        const classData = buildClassFile('com/example/Hello');
        const zip = buildZip([
            { name: 'META-INF/MANIFEST.MF', data: Buffer.from('Manifest-Version: 1.0\n'), compress: false },
            { name: 'com/example/Hello.class', data: classData, compress: true },
        ]);

        const entries = parseZipEntries(zip);
        const classEntry = entries.find(e => e.fileName.endsWith('.class'));
        expect(classEntry).toBeDefined();

        const extracted = extractEntry(zip, classEntry!);
        expect(extracted).not.toBeNull();
        expect(extracted!.readUInt32BE(0)).toBe(0xcafebabe);
    });
});

// ── JarIndex unit tests (in-memory) ───────────────────────────────

describe('JarIndex', () => {
    let index: JarIndex;

    beforeEach(() => {
        index = new JarIndex(createTestLogger());
    });

    describe('findType', () => {
        it('should return undefined for unknown type', () => {
            expect(index.findType('com.example.NonExistent')).toBeUndefined();
        });
    });

    describe('findTypesBySimpleName', () => {
        it('should return empty array for unknown simple name', () => {
            expect(index.findTypesBySimpleName('NonExistent')).toEqual([]);
        });
    });

    describe('searchTypes', () => {
        it('should return empty array on empty index', () => {
            expect(index.searchTypes('Str')).toEqual([]);
        });
    });

    describe('getTypesInPackage', () => {
        it('should return empty array for unknown package', () => {
            expect(index.getTypesInPackage('com.unknown')).toEqual([]);
        });
    });

    describe('size and clear', () => {
        it('should start at size 0', () => {
            expect(index.size).toBe(0);
        });

        it('should clear the index', () => {
            index.clear();
            expect(index.size).toBe(0);
        });
    });
});

// ── JarIndex with real JAR file on disk ────────────────────────────

describe('JarIndex with JAR file', () => {
    let tempDir: string;
    let jarPath: string;
    let index: JarIndex;

    const dep: ResolvedDependency = {
        groupId: 'com.example',
        artifactId: 'test-lib',
        version: '1.0.0',
        jarPath: '', // set in beforeAll
        sourceJarPath: '/fake/test-lib-1.0.0-sources.jar',
        scope: 'compile',
    };

    beforeAll(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'jar-index-test-'));
        jarPath = join(tempDir, 'test-lib-1.0.0.jar');

        const jar = buildZip([
            {
                name: 'META-INF/MANIFEST.MF',
                data: Buffer.from('Manifest-Version: 1.0\n'),
                compress: false,
            },
            {
                name: 'com/example/Hello.class',
                data: buildClassFile('com/example/Hello'),
                compress: true,
            },
            {
                name: 'com/example/World.class',
                data: buildClassFile('com/example/World'),
                compress: true,
            },
            {
                name: 'com/example/other/Util.class',
                data: buildClassFile('com/example/other/Util'),
                compress: false,
            },
            // Inner class — should be skipped
            {
                name: 'com/example/Hello$Inner.class',
                data: buildClassFile('com/example/Hello$Inner'),
                compress: true,
            },
            // package-info — should be skipped
            {
                name: 'com/example/package-info.class',
                data: Buffer.alloc(10),
                compress: false,
            },
            // module-info — should be skipped
            {
                name: 'module-info.class',
                data: Buffer.alloc(10),
                compress: false,
            },
            // Non-public class — should be skipped by JarIndex
            {
                name: 'com/example/internal/Secret.class',
                data: buildPackagePrivateClassFile('com/example/internal/Secret'),
                compress: true,
            },
        ]);

        await writeFile(jarPath, jar);
        dep.jarPath = jarPath;
    });

    afterAll(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        index = new JarIndex(createTestLogger());
    });

    it('should index a JAR file and return type count', async () => {
        const count = await index.indexJar(jarPath, dep);
        // Hello, World, Util are public; Inner/$, package-info, module-info, Secret are skipped
        expect(count).toBe(3);
        expect(index.size).toBe(3);
    });

    it('should find type by fully qualified name', async () => {
        await index.indexJar(jarPath, dep);

        const hello = index.findType('com.example.Hello');
        expect(hello).toBeDefined();
        expect(hello!.className).toBe('com.example.Hello');
        expect(hello!.simpleName).toBe('Hello');
        expect(hello!.packageName).toBe('com.example');
        expect(hello!.jarPath).toBe(jarPath);
        expect(hello!.sourceJarPath).toBe('/fake/test-lib-1.0.0-sources.jar');
        expect(hello!.dependency).toEqual({
            groupId: 'com.example',
            artifactId: 'test-lib',
            version: '1.0.0',
        });
    });

    it('should find types by simple name', async () => {
        await index.indexJar(jarPath, dep);

        const results = index.findTypesBySimpleName('Hello');
        expect(results).toHaveLength(1);
        expect(results[0].className).toBe('com.example.Hello');
    });

    it('should return multiple types with same simple name', async () => {
        // Create a second JAR with a different Hello class
        const jar2Path = join(tempDir, 'other-lib-1.0.0.jar');
        const jar2 = buildZip([
            {
                name: 'org/other/Hello.class',
                data: buildClassFile('org/other/Hello'),
                compress: true,
            },
        ]);
        await writeFile(jar2Path, jar2);

        const dep2: ResolvedDependency = {
            groupId: 'org.other',
            artifactId: 'other-lib',
            version: '1.0.0',
            jarPath: jar2Path,
            scope: 'compile',
        };

        await index.indexJar(jarPath, dep);
        await index.indexJar(jar2Path, dep2);

        const results = index.findTypesBySimpleName('Hello');
        expect(results).toHaveLength(2);
        const classNames = results.map(r => r.className).sort();
        expect(classNames).toEqual(['com.example.Hello', 'org.other.Hello']);
    });

    it('should search types by simple name prefix', async () => {
        await index.indexJar(jarPath, dep);

        const results = index.searchTypes('Hel');
        expect(results).toHaveLength(1);
        expect(results[0].simpleName).toBe('Hello');
    });

    it('should search types by qualified name prefix', async () => {
        await index.indexJar(jarPath, dep);

        const results = index.searchTypes('com.example.W');
        expect(results).toHaveLength(1);
        expect(results[0].simpleName).toBe('World');
    });

    it('should search types case-insensitively', async () => {
        await index.indexJar(jarPath, dep);

        const results = index.searchTypes('hel');
        expect(results).toHaveLength(1);
        expect(results[0].simpleName).toBe('Hello');
    });

    it('should respect search limit', async () => {
        await index.indexJar(jarPath, dep);

        // All 3 types match empty-ish prefix (any letter)
        const results = index.searchTypes('', 2);
        expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should get types in a package', async () => {
        await index.indexJar(jarPath, dep);

        const comExample = index.getTypesInPackage('com.example');
        expect(comExample).toHaveLength(2);
        const names = comExample.map(t => t.simpleName).sort();
        expect(names).toEqual(['Hello', 'World']);
    });

    it('should get types in nested package', async () => {
        await index.indexJar(jarPath, dep);

        const other = index.getTypesInPackage('com.example.other');
        expect(other).toHaveLength(1);
        expect(other[0].simpleName).toBe('Util');
    });

    it('should not index non-public classes', async () => {
        await index.indexJar(jarPath, dep);

        expect(index.findType('com.example.internal.Secret')).toBeUndefined();
    });

    it('should not index inner classes', async () => {
        await index.indexJar(jarPath, dep);

        expect(index.findType('com.example.Hello$Inner')).toBeUndefined();
    });

    it('should expose classInfo on indexed type', async () => {
        await index.indexJar(jarPath, dep);

        const hello = index.findType('com.example.Hello')!;
        expect(hello.classInfo).toBeDefined();
        expect(hello.classInfo.isPublic).toBe(true);
        expect(hello.classInfo.majorVersion).toBe(61);
        expect(hello.classInfo.superClassName).toBe('java.lang.Object');
    });

    it('should clear the index', async () => {
        await index.indexJar(jarPath, dep);
        expect(index.size).toBe(3);

        index.clear();
        expect(index.size).toBe(0);
        expect(index.findType('com.example.Hello')).toBeUndefined();
        expect(index.findTypesBySimpleName('Hello')).toEqual([]);
    });

    it('should index dependencies via indexDependencies', async () => {
        await index.indexDependencies([dep]);

        expect(index.size).toBe(3);
        expect(index.findType('com.example.Hello')).toBeDefined();
    });

    it('should handle indexDependencies with non-existent JAR gracefully', async () => {
        const badDep: ResolvedDependency = {
            groupId: 'com.bad',
            artifactId: 'missing',
            version: '1.0.0',
            jarPath: '/nonexistent/path/missing.jar',
            scope: 'compile',
        };

        // Should not throw
        await index.indexDependencies([badDep]);
        expect(index.size).toBe(0);
    });
});
