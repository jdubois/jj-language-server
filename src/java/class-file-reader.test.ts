/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import {
    parseMethodDescriptor,
    parseFieldDescriptor,
    readClassFile,
} from './class-file-reader.js';

// ── parseMethodDescriptor ──────────────────────────────────────────

describe('parseMethodDescriptor', () => {
    it('should parse void no-arg method', () => {
        const result = parseMethodDescriptor('()V');
        expect(result.parameterTypes).toEqual([]);
        expect(result.returnType).toBe('void');
    });

    it('should parse method with primitive parameters', () => {
        const result = parseMethodDescriptor('(IZ)V');
        expect(result.parameterTypes).toEqual(['int', 'boolean']);
        expect(result.returnType).toBe('void');
    });

    it('should parse method with object parameter and return type', () => {
        const result = parseMethodDescriptor('(Ljava/lang/String;)Ljava/lang/Object;');
        expect(result.parameterTypes).toEqual(['String']);
        expect(result.returnType).toBe('Object');
    });

    it('should parse method with mixed parameters', () => {
        const result = parseMethodDescriptor('(Ljava/lang/String;I)V');
        expect(result.parameterTypes).toEqual(['String', 'int']);
        expect(result.returnType).toBe('void');
    });

    it('should parse method returning int', () => {
        const result = parseMethodDescriptor('()I');
        expect(result.parameterTypes).toEqual([]);
        expect(result.returnType).toBe('int');
    });

    it('should parse method with all primitive types', () => {
        const result = parseMethodDescriptor('(BCDFIJSZ)V');
        expect(result.parameterTypes).toEqual([
            'byte',
            'char',
            'double',
            'float',
            'int',
            'long',
            'short',
            'boolean',
        ]);
    });

    it('should parse method with array parameter', () => {
        const result = parseMethodDescriptor('([I)V');
        expect(result.parameterTypes).toEqual(['int[]']);
    });

    it('should parse method with object array parameter', () => {
        const result = parseMethodDescriptor('([Ljava/lang/String;)V');
        expect(result.parameterTypes).toEqual(['String[]']);
    });

    it('should parse method returning array', () => {
        const result = parseMethodDescriptor('()[Ljava/lang/String;');
        expect(result.returnType).toBe('String[]');
    });

    it('should parse method with multidimensional array', () => {
        const result = parseMethodDescriptor('([[I)V');
        expect(result.parameterTypes).toEqual(['int[][]']);
    });

    it('should parse main method descriptor', () => {
        const result = parseMethodDescriptor('([Ljava/lang/String;)V');
        expect(result.parameterTypes).toEqual(['String[]']);
        expect(result.returnType).toBe('void');
    });

    it('should parse method with multiple object params', () => {
        const result = parseMethodDescriptor(
            '(Ljava/util/List;Ljava/util/Map;)Ljava/util/Set;',
        );
        expect(result.parameterTypes).toEqual(['List', 'Map']);
        expect(result.returnType).toBe('Set');
    });

    it('should handle long and double params', () => {
        const result = parseMethodDescriptor('(JD)J');
        expect(result.parameterTypes).toEqual(['long', 'double']);
        expect(result.returnType).toBe('long');
    });
});

// ── parseFieldDescriptor ───────────────────────────────────────────

describe('parseFieldDescriptor', () => {
    it('should parse primitive types', () => {
        expect(parseFieldDescriptor('I')).toBe('int');
        expect(parseFieldDescriptor('Z')).toBe('boolean');
        expect(parseFieldDescriptor('B')).toBe('byte');
        expect(parseFieldDescriptor('C')).toBe('char');
        expect(parseFieldDescriptor('D')).toBe('double');
        expect(parseFieldDescriptor('F')).toBe('float');
        expect(parseFieldDescriptor('J')).toBe('long');
        expect(parseFieldDescriptor('S')).toBe('short');
    });

    it('should parse object type', () => {
        expect(parseFieldDescriptor('Ljava/lang/String;')).toBe('String');
    });

    it('should parse nested object type', () => {
        expect(parseFieldDescriptor('Ljava/util/concurrent/ConcurrentHashMap;')).toBe(
            'ConcurrentHashMap',
        );
    });

    it('should parse primitive array', () => {
        expect(parseFieldDescriptor('[I')).toBe('int[]');
    });

    it('should parse object array', () => {
        expect(parseFieldDescriptor('[Ljava/lang/String;')).toBe('String[]');
    });

    it('should parse multidimensional array', () => {
        expect(parseFieldDescriptor('[[D')).toBe('double[][]');
    });

    it('should parse array of object arrays', () => {
        expect(parseFieldDescriptor('[[Ljava/lang/Object;')).toBe('Object[][]');
    });
});

// ── readClassFile ──────────────────────────────────────────────────

/**
 * Build a minimal but valid class file buffer for testing.
 *
 * The class file represents:
 * ```
 * public class com/example/Hello extends java/lang/Object implements java/io/Serializable {
 *     public static final int VALUE;   // descriptor: I
 *     public void <init>()V;
 *     public static void main([Ljava/lang/String;)V;
 * }
 * ```
 */
function buildMinimalClassFile(): Buffer {
    const parts: Buffer[] = [];

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
    function utf8(str: string): Buffer {
        const strBuf = Buffer.from(str, 'utf8');
        return Buffer.concat([u1(1), u2(strBuf.length), strBuf]);
    }
    function classRef(nameIndex: number): Buffer {
        return Buffer.concat([u1(7), u2(nameIndex)]);
    }

    // Constant pool entries (1-based):
    //  1: Utf8  "com/example/Hello"
    //  2: Class #1
    //  3: Utf8  "java/lang/Object"
    //  4: Class #3
    //  5: Utf8  "java/io/Serializable"
    //  6: Class #5
    //  7: Utf8  "VALUE"
    //  8: Utf8  "I"
    //  9: Utf8  "<init>"
    // 10: Utf8  "()V"
    // 11: Utf8  "main"
    // 12: Utf8  "([Ljava/lang/String;)V"
    const cpEntries = [
        utf8('com/example/Hello'),        // #1
        classRef(1),                       // #2
        utf8('java/lang/Object'),          // #3
        classRef(3),                       // #4
        utf8('java/io/Serializable'),      // #5
        classRef(5),                       // #6
        utf8('VALUE'),                     // #7
        utf8('I'),                         // #8
        utf8('<init>'),                    // #9
        utf8('()V'),                       // #10
        utf8('main'),                      // #11
        utf8('([Ljava/lang/String;)V'),    // #12
    ];
    const cpCount = cpEntries.length + 1; // +1 because index 0 is unused

    // Magic
    parts.push(u4(0xcafebabe));
    // Version: Java 17 (major=61, minor=0)
    parts.push(u2(0)); // minor
    parts.push(u2(61)); // major
    // Constant pool
    parts.push(u2(cpCount));
    for (const entry of cpEntries) {
        parts.push(entry);
    }
    // Access flags: ACC_PUBLIC (0x0001)
    parts.push(u2(0x0001));
    // this_class: #2
    parts.push(u2(2));
    // super_class: #4
    parts.push(u2(4));
    // Interfaces count: 1
    parts.push(u2(1));
    // Interfaces: #6
    parts.push(u2(6));

    // Fields count: 1
    parts.push(u2(1));
    // Field: public static final int VALUE
    // access_flags: ACC_PUBLIC | ACC_STATIC | ACC_FINAL = 0x0019
    parts.push(u2(0x0019));
    // name_index: #7 ("VALUE")
    parts.push(u2(7));
    // descriptor_index: #8 ("I")
    parts.push(u2(8));
    // attributes_count: 0
    parts.push(u2(0));

    // Methods count: 2
    parts.push(u2(2));

    // Method 1: public void <init>()V
    parts.push(u2(0x0001)); // ACC_PUBLIC
    parts.push(u2(9));      // name: #9 "<init>"
    parts.push(u2(10));     // descriptor: #10 "()V"
    parts.push(u2(0));      // attributes_count: 0

    // Method 2: public static void main(String[])
    parts.push(u2(0x0009)); // ACC_PUBLIC | ACC_STATIC
    parts.push(u2(11));     // name: #11 "main"
    parts.push(u2(12));     // descriptor: #12 "([Ljava/lang/String;)V"
    parts.push(u2(0));      // attributes_count: 0

    // Class attributes count: 0
    parts.push(u2(0));

    return Buffer.concat(parts);
}

describe('readClassFile', () => {
    it('should return null for empty buffer', () => {
        expect(readClassFile(Buffer.alloc(0))).toBeNull();
    });

    it('should return null for buffer too small', () => {
        expect(readClassFile(Buffer.alloc(5))).toBeNull();
    });

    it('should return null for wrong magic number', () => {
        const buf = Buffer.alloc(16);
        buf.writeUInt32BE(0xdeadbeef, 0);
        expect(readClassFile(buf)).toBeNull();
    });

    it('should parse a minimal valid class file', () => {
        const buf = buildMinimalClassFile();
        const info = readClassFile(buf);

        expect(info).not.toBeNull();
        expect(info!.className).toBe('com.example.Hello');
        expect(info!.simpleName).toBe('Hello');
        expect(info!.packageName).toBe('com.example');
        expect(info!.superClassName).toBe('java.lang.Object');
        expect(info!.majorVersion).toBe(61);
    });

    it('should parse access flags correctly', () => {
        const info = readClassFile(buildMinimalClassFile())!;

        expect(info.isPublic).toBe(true);
        expect(info.isAbstract).toBe(false);
        expect(info.isInterface).toBe(false);
        expect(info.isEnum).toBe(false);
        expect(info.isAnnotation).toBe(false);
    });

    it('should parse interfaces', () => {
        const info = readClassFile(buildMinimalClassFile())!;

        expect(info.interfaces).toEqual(['java.io.Serializable']);
    });

    it('should parse fields', () => {
        const info = readClassFile(buildMinimalClassFile())!;

        expect(info.fields).toHaveLength(1);
        const field = info.fields[0];
        expect(field.name).toBe('VALUE');
        expect(field.type).toBe('int');
        expect(field.descriptor).toBe('I');
        expect(field.isPublic).toBe(true);
        expect(field.isStatic).toBe(true);
        expect(field.isFinal).toBe(true);
    });

    it('should parse methods', () => {
        const info = readClassFile(buildMinimalClassFile())!;

        expect(info.methods).toHaveLength(2);

        const init = info.methods[0];
        expect(init.name).toBe('<init>');
        expect(init.returnType).toBe('void');
        expect(init.parameterTypes).toEqual([]);
        expect(init.isPublic).toBe(true);
        expect(init.isStatic).toBe(false);

        const main = info.methods[1];
        expect(main.name).toBe('main');
        expect(main.returnType).toBe('void');
        expect(main.parameterTypes).toEqual(['String[]']);
        expect(main.isPublic).toBe(true);
        expect(main.isStatic).toBe(true);
    });

    it('should return null for truncated class file', () => {
        const full = buildMinimalClassFile();
        // Cut off mid-constant-pool
        const truncated = full.subarray(0, 20);
        expect(readClassFile(truncated)).toBeNull();
    });
});
