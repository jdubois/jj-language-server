/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import type { ClassFileInfo } from '../java/class-file-reader.js';
import type { ResolvedDependency } from './classpath-resolver.js';
import type { Logger } from '../utils/logger.js';
import { readClassFile } from '../java/class-file-reader.js';

// ── Public interfaces ──────────────────────────────────────────────

export interface IndexedType {
    className: string;
    simpleName: string;
    packageName: string;
    jarPath: string;
    sourceJarPath?: string;
    dependency: { groupId: string; artifactId: string; version: string };
    classInfo: ClassFileInfo;
}

// ── ZIP constants ──────────────────────────────────────────────────

const EOCD_SIGNATURE = 0x06054b50;
const CD_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const COMPRESSION_STORED = 0;
const COMPRESSION_DEFLATE = 8;

// ── ZIP entry ──────────────────────────────────────────────────────

export interface ZipEntry {
    fileName: string;
    compressedSize: number;
    uncompressedSize: number;
    compressionMethod: number;
    localHeaderOffset: number;
}

// ── Minimal ZIP reader ─────────────────────────────────────────────

/**
 * Find the End of Central Directory record by scanning backwards from EOF.
 * Returns the offset of the EOCD signature, or -1 if not found.
 */
function findEocd(buf: Buffer): number {
    // EOCD is at least 22 bytes; scan backwards up to 65557 bytes (max comment size + EOCD)
    const minOffset = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= minOffset; i--) {
        if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
            return i;
        }
    }
    return -1;
}

/**
 * Parse the central directory of a ZIP buffer and return all entries.
 */
export function parseZipEntries(buf: Buffer): ZipEntry[] {
    const eocdOffset = findEocd(buf);
    if (eocdOffset === -1) return [];

    const cdSize = buf.readUInt32LE(eocdOffset + 12);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);

    // Validate offsets
    if (cdOffset + cdSize > buf.length) return [];

    const entries: ZipEntry[] = [];
    let pos = cdOffset;
    const cdEnd = cdOffset + cdSize;

    while (pos + 46 <= cdEnd) {
        const sig = buf.readUInt32LE(pos);
        if (sig !== CD_SIGNATURE) break;

        const compressionMethod = buf.readUInt16LE(pos + 10);
        const compressedSize = buf.readUInt32LE(pos + 20);
        const uncompressedSize = buf.readUInt32LE(pos + 24);
        const fileNameLength = buf.readUInt16LE(pos + 28);
        const extraFieldLength = buf.readUInt16LE(pos + 30);
        const commentLength = buf.readUInt16LE(pos + 32);
        const localHeaderOffset = buf.readUInt32LE(pos + 42);

        const fileNameStart = pos + 46;
        if (fileNameStart + fileNameLength > buf.length) break;

        const fileName = buf.subarray(fileNameStart, fileNameStart + fileNameLength).toString('utf8');

        entries.push({
            fileName,
            compressedSize,
            uncompressedSize,
            compressionMethod,
            localHeaderOffset,
        });

        pos = fileNameStart + fileNameLength + extraFieldLength + commentLength;
    }

    return entries;
}

/**
 * Extract a single entry's uncompressed data from the ZIP buffer.
 */
export function extractEntry(buf: Buffer, entry: ZipEntry): Buffer | null {
    const offset = entry.localHeaderOffset;
    if (offset + 30 > buf.length) return null;

    const sig = buf.readUInt32LE(offset);
    if (sig !== LOCAL_HEADER_SIGNATURE) return null;

    const localFileNameLength = buf.readUInt16LE(offset + 26);
    const localExtraLength = buf.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + localFileNameLength + localExtraLength;

    if (entry.compressionMethod === COMPRESSION_STORED) {
        const end = dataStart + entry.uncompressedSize;
        if (end > buf.length) return null;
        return buf.subarray(dataStart, end);
    }

    if (entry.compressionMethod === COMPRESSION_DEFLATE) {
        const compressedEnd = dataStart + entry.compressedSize;
        if (compressedEnd > buf.length) return null;
        const compressed = buf.subarray(dataStart, compressedEnd);
        try {
            return inflateRawSync(compressed);
        } catch {
            return null;
        }
    }

    // Unsupported compression method
    return null;
}

// ── Filtering helpers ──────────────────────────────────────────────

function shouldIndexEntry(fileName: string): boolean {
    if (!fileName.endsWith('.class')) return false;
    if (fileName.endsWith('package-info.class')) return false;
    if (fileName.endsWith('module-info.class')) return false;

    // Extract the simple file name (after last /)
    const simpleName = fileName.substring(fileName.lastIndexOf('/') + 1);
    // Skip inner classes (contain $)
    if (simpleName.includes('$')) return false;

    return true;
}

// ── JarIndex ───────────────────────────────────────────────────────

export class JarIndex {
    private typesByName: Map<string, IndexedType> = new Map();
    private typesBySimpleName: Map<string, IndexedType[]> = new Map();
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Index all JARs from resolved dependencies.
     */
    async indexDependencies(dependencies: ResolvedDependency[]): Promise<void> {
        for (const dep of dependencies) {
            try {
                const count = await this.indexJar(dep.jarPath, dep);
                this.logger.log(`Indexed ${count} types from ${dep.artifactId}-${dep.version}`);
            } catch (e) {
                this.logger.warn(
                    `Failed to index JAR ${dep.jarPath}: ${e instanceof Error ? e.message : String(e)}`,
                );
            }
        }
    }

    /**
     * Index a single JAR file. Returns the number of types indexed.
     */
    async indexJar(jarPath: string, dep: ResolvedDependency): Promise<number> {
        const buf = await readFile(jarPath);
        const entries = parseZipEntries(buf);
        let count = 0;

        for (const entry of entries) {
            if (!shouldIndexEntry(entry.fileName)) continue;

            const classBytes = extractEntry(buf, entry);
            if (!classBytes) continue;

            const classInfo = readClassFile(classBytes);
            if (!classInfo) continue;
            if (!classInfo.isPublic) continue;

            const indexed: IndexedType = {
                className: classInfo.className,
                simpleName: classInfo.simpleName,
                packageName: classInfo.packageName,
                jarPath,
                sourceJarPath: dep.sourceJarPath,
                dependency: {
                    groupId: dep.groupId,
                    artifactId: dep.artifactId,
                    version: dep.version,
                },
                classInfo,
            };

            this.typesByName.set(classInfo.className, indexed);

            const existing = this.typesBySimpleName.get(classInfo.simpleName);
            if (existing) {
                existing.push(indexed);
            } else {
                this.typesBySimpleName.set(classInfo.simpleName, [indexed]);
            }

            count++;
        }

        return count;
    }

    /**
     * Find a type by fully qualified name.
     */
    findType(qualifiedName: string): IndexedType | undefined {
        return this.typesByName.get(qualifiedName);
    }

    /**
     * Find types by simple name (may return multiple from different packages).
     */
    findTypesBySimpleName(simpleName: string): IndexedType[] {
        return this.typesBySimpleName.get(simpleName) ?? [];
    }

    /**
     * Search types by prefix (for completion). Matches against both simple names
     * and fully qualified names. Returns up to `limit` results (default 50).
     */
    searchTypes(query: string, limit = 50): IndexedType[] {
        const results: IndexedType[] = [];
        const lowerQuery = query.toLowerCase();

        for (const indexed of this.typesByName.values()) {
            if (results.length >= limit) break;

            if (
                indexed.simpleName.toLowerCase().startsWith(lowerQuery) ||
                indexed.className.toLowerCase().startsWith(lowerQuery)
            ) {
                results.push(indexed);
            }
        }

        return results;
    }

    /**
     * Get all types in a package.
     */
    getTypesInPackage(packageName: string): IndexedType[] {
        const results: IndexedType[] = [];
        for (const indexed of this.typesByName.values()) {
            if (indexed.packageName === packageName) {
                results.push(indexed);
            }
        }
        return results;
    }

    /**
     * Get total number of indexed types.
     */
    get size(): number {
        return this.typesByName.size;
    }

    /**
     * Clear the index.
     */
    clear(): void {
        this.typesByName.clear();
        this.typesBySimpleName.clear();
    }
}
