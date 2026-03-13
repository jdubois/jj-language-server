/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

// ── Public interfaces ──────────────────────────────────────────────

export interface ClassFileInfo {
    className: string;
    simpleName: string;
    packageName: string;
    superClassName?: string;
    interfaces: string[];
    accessFlags: number;
    isPublic: boolean;
    isAbstract: boolean;
    isInterface: boolean;
    isEnum: boolean;
    isAnnotation: boolean;
    fields: ClassFieldInfo[];
    methods: ClassMethodInfo[];
    majorVersion: number;
}

export interface ClassFieldInfo {
    name: string;
    type: string;
    descriptor: string;
    isPublic: boolean;
    isStatic: boolean;
    isFinal: boolean;
}

export interface ClassMethodInfo {
    name: string;
    returnType: string;
    parameterTypes: string[];
    descriptor: string;
    isPublic: boolean;
    isStatic: boolean;
    isAbstract: boolean;
    isSynthetic: boolean;
}

// ── Constants ──────────────────────────────────────────────────────

const MAGIC = 0xcafebabe;

const CONSTANT_Utf8 = 1;
const CONSTANT_Integer = 3;
const CONSTANT_Float = 4;
const CONSTANT_Long = 5;
const CONSTANT_Double = 6;
const CONSTANT_Class = 7;
const CONSTANT_String = 8;
const CONSTANT_Fieldref = 9;
const CONSTANT_Methodref = 10;
const CONSTANT_InterfaceMethodref = 11;
const CONSTANT_NameAndType = 12;
const CONSTANT_MethodHandle = 15;
const CONSTANT_MethodType = 16;
const CONSTANT_InvokeDynamic = 18;

const ACC_PUBLIC = 0x0001;
const ACC_STATIC = 0x0008;
const ACC_FINAL = 0x0010;
const ACC_INTERFACE = 0x0200;
const ACC_ABSTRACT = 0x0400;
const ACC_SYNTHETIC = 0x1000;
const ACC_ANNOTATION = 0x2000;
const ACC_ENUM = 0x4000;

// ── Constant pool entry types ──────────────────────────────────────

interface CpUtf8 {
    tag: typeof CONSTANT_Utf8;
    value: string;
}

interface CpClass {
    tag: typeof CONSTANT_Class;
    nameIndex: number;
}

interface CpNameAndType {
    tag: typeof CONSTANT_NameAndType;
    nameIndex: number;
    descriptorIndex: number;
}

interface CpString {
    tag: typeof CONSTANT_String;
    stringIndex: number;
}

interface CpRef {
    tag:
        | typeof CONSTANT_Fieldref
        | typeof CONSTANT_Methodref
        | typeof CONSTANT_InterfaceMethodref;
    classIndex: number;
    nameAndTypeIndex: number;
}

interface CpNumeric {
    tag:
        | typeof CONSTANT_Integer
        | typeof CONSTANT_Float
        | typeof CONSTANT_Long
        | typeof CONSTANT_Double;
}

interface CpMethodHandle {
    tag: typeof CONSTANT_MethodHandle;
}

interface CpMethodType {
    tag: typeof CONSTANT_MethodType;
    descriptorIndex: number;
}

interface CpInvokeDynamic {
    tag: typeof CONSTANT_InvokeDynamic;
}

type CpEntry =
    | CpUtf8
    | CpClass
    | CpNameAndType
    | CpString
    | CpRef
    | CpNumeric
    | CpMethodHandle
    | CpMethodType
    | CpInvokeDynamic
    | null;

// ── Binary reader helper ───────────────────────────────────────────

class BufferReader {
    private offset = 0;

    constructor(private readonly buf: Buffer) {}

    get position(): number {
        return this.offset;
    }

    hasRemaining(bytes: number): boolean {
        return this.offset + bytes <= this.buf.length;
    }

    u1(): number {
        if (!this.hasRemaining(1)) throw new RangeError('Unexpected end of class file');
        return this.buf.readUInt8(this.offset++);
    }

    u2(): number {
        if (!this.hasRemaining(2)) throw new RangeError('Unexpected end of class file');
        const val = this.buf.readUInt16BE(this.offset);
        this.offset += 2;
        return val;
    }

    u4(): number {
        if (!this.hasRemaining(4)) throw new RangeError('Unexpected end of class file');
        const val = this.buf.readUInt32BE(this.offset);
        this.offset += 4;
        return val;
    }

    bytes(length: number): Buffer {
        if (!this.hasRemaining(length)) throw new RangeError('Unexpected end of class file');
        const slice = this.buf.subarray(this.offset, this.offset + length);
        this.offset += length;
        return slice;
    }

    skip(n: number): void {
        if (!this.hasRemaining(n)) throw new RangeError('Unexpected end of class file');
        this.offset += n;
    }
}

// ── Descriptor parsing ─────────────────────────────────────────────

const PRIMITIVE_TYPES: Record<string, string> = {
    B: 'byte',
    C: 'char',
    D: 'double',
    F: 'float',
    I: 'int',
    J: 'long',
    S: 'short',
    Z: 'boolean',
    V: 'void',
};

function parseTypeDescriptor(descriptor: string, pos: { i: number }): string {
    const ch = descriptor[pos.i];

    if (ch === 'L') {
        const semi = descriptor.indexOf(';', pos.i);
        if (semi === -1) return 'Object';
        const internalName = descriptor.substring(pos.i + 1, semi);
        pos.i = semi + 1;
        const parts = internalName.split('/');
        return parts[parts.length - 1];
    }

    if (ch === '[') {
        pos.i++;
        const componentType = parseTypeDescriptor(descriptor, pos);
        return componentType + '[]';
    }

    const primitive = PRIMITIVE_TYPES[ch];
    if (primitive) {
        pos.i++;
        return primitive;
    }

    pos.i++;
    return 'unknown';
}

/**
 * Parse a JVM method descriptor into human-readable parameter and return types.
 *
 * Example: `(Ljava/lang/String;I)V` → `{ parameterTypes: ['String', 'int'], returnType: 'void' }`
 */
export function parseMethodDescriptor(descriptor: string): {
    parameterTypes: string[];
    returnType: string;
} {
    const parameterTypes: string[] = [];

    if (descriptor[0] !== '(') {
        return { parameterTypes: [], returnType: 'void' };
    }

    const pos = { i: 1 };

    while (pos.i < descriptor.length && descriptor[pos.i] !== ')') {
        parameterTypes.push(parseTypeDescriptor(descriptor, pos));
    }

    // Skip closing paren
    if (pos.i < descriptor.length && descriptor[pos.i] === ')') {
        pos.i++;
    }

    const returnType =
        pos.i < descriptor.length ? parseTypeDescriptor(descriptor, pos) : 'void';

    return { parameterTypes, returnType };
}

/**
 * Convert a JVM field descriptor to a human-readable type string.
 *
 * Example: `Ljava/lang/String;` → `String`, `[I` → `int[]`
 */
export function parseFieldDescriptor(descriptor: string): string {
    const pos = { i: 0 };
    return parseTypeDescriptor(descriptor, pos);
}

// ── Class name helpers ─────────────────────────────────────────────

function internalToQualified(name: string): string {
    return name.replace(/\//g, '.');
}

function qualifiedToSimple(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? name : name.substring(dot + 1);
}

function qualifiedToPackage(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.substring(0, dot);
}

// ── Constant pool parsing ──────────────────────────────────────────

function readConstantPool(reader: BufferReader, count: number): CpEntry[] {
    // Index 0 is unused; entries are 1-based
    const pool: CpEntry[] = [null];

    for (let i = 1; i < count; i++) {
        const tag = reader.u1();

        switch (tag) {
            case CONSTANT_Utf8: {
                const length = reader.u2();
                const value = reader.bytes(length).toString('utf8');
                pool.push({ tag, value });
                break;
            }
            case CONSTANT_Integer:
            case CONSTANT_Float:
                reader.skip(4);
                pool.push({ tag } as CpNumeric);
                break;
            case CONSTANT_Long:
            case CONSTANT_Double:
                reader.skip(8);
                pool.push({ tag } as CpNumeric);
                // Long and Double occupy two constant pool slots
                pool.push(null);
                i++;
                break;
            case CONSTANT_Class:
                pool.push({ tag, nameIndex: reader.u2() });
                break;
            case CONSTANT_String:
                pool.push({ tag, stringIndex: reader.u2() });
                break;
            case CONSTANT_Fieldref:
            case CONSTANT_Methodref:
            case CONSTANT_InterfaceMethodref:
                pool.push({
                    tag,
                    classIndex: reader.u2(),
                    nameAndTypeIndex: reader.u2(),
                } as CpRef);
                break;
            case CONSTANT_NameAndType:
                pool.push({
                    tag,
                    nameIndex: reader.u2(),
                    descriptorIndex: reader.u2(),
                });
                break;
            case CONSTANT_MethodHandle:
                reader.skip(3); // reference_kind (u1) + reference_index (u2)
                pool.push({ tag } as CpMethodHandle);
                break;
            case CONSTANT_MethodType:
                pool.push({ tag, descriptorIndex: reader.u2() });
                break;
            case CONSTANT_InvokeDynamic:
                reader.skip(4); // bootstrap_method_attr_index (u2) + name_and_type_index (u2)
                pool.push({ tag } as CpInvokeDynamic);
                break;
            default:
                // Unknown tag — cannot continue parsing safely
                return pool;
        }
    }

    return pool;
}

function getUtf8(pool: CpEntry[], index: number): string | undefined {
    const entry = pool[index];
    if (entry && entry.tag === CONSTANT_Utf8) {
        return entry.value;
    }
    return undefined;
}

function getClassName(pool: CpEntry[], index: number): string | undefined {
    const entry = pool[index];
    if (entry && entry.tag === CONSTANT_Class) {
        const name = getUtf8(pool, entry.nameIndex);
        return name ? internalToQualified(name) : undefined;
    }
    return undefined;
}

// ── Field and method parsing ───────────────────────────────────────

function readFields(reader: BufferReader, pool: CpEntry[]): ClassFieldInfo[] {
    const count = reader.u2();
    const fields: ClassFieldInfo[] = [];

    for (let i = 0; i < count; i++) {
        const flags = reader.u2();
        const nameIndex = reader.u2();
        const descriptorIndex = reader.u2();
        const attributesCount = reader.u2();

        // Skip all attributes
        for (let a = 0; a < attributesCount; a++) {
            reader.skip(2); // attribute_name_index
            const attrLength = reader.u4();
            reader.skip(attrLength);
        }

        const name = getUtf8(pool, nameIndex) ?? '<unknown>';
        const descriptor = getUtf8(pool, descriptorIndex) ?? '';

        fields.push({
            name,
            type: parseFieldDescriptor(descriptor),
            descriptor,
            isPublic: (flags & ACC_PUBLIC) !== 0,
            isStatic: (flags & ACC_STATIC) !== 0,
            isFinal: (flags & ACC_FINAL) !== 0,
        });
    }

    return fields;
}

function readMethods(reader: BufferReader, pool: CpEntry[]): ClassMethodInfo[] {
    const count = reader.u2();
    const methods: ClassMethodInfo[] = [];

    for (let i = 0; i < count; i++) {
        const flags = reader.u2();
        const nameIndex = reader.u2();
        const descriptorIndex = reader.u2();
        const attributesCount = reader.u2();

        // Skip all attributes
        for (let a = 0; a < attributesCount; a++) {
            reader.skip(2); // attribute_name_index
            const attrLength = reader.u4();
            reader.skip(attrLength);
        }

        const name = getUtf8(pool, nameIndex) ?? '<unknown>';
        const descriptor = getUtf8(pool, descriptorIndex) ?? '()V';
        const parsed = parseMethodDescriptor(descriptor);

        methods.push({
            name,
            returnType: parsed.returnType,
            parameterTypes: parsed.parameterTypes,
            descriptor,
            isPublic: (flags & ACC_PUBLIC) !== 0,
            isStatic: (flags & ACC_STATIC) !== 0,
            isAbstract: (flags & ACC_ABSTRACT) !== 0,
            isSynthetic: (flags & ACC_SYNTHETIC) !== 0,
        });
    }

    return methods;
}

// ── Main entry point ───────────────────────────────────────────────

/**
 * Parse a Java `.class` file buffer and extract type metadata.
 *
 * Returns `null` if the buffer is not a valid class file (wrong magic number
 * or truncated data). This function does **not** require a JVM.
 */
export function readClassFile(buffer: Buffer): ClassFileInfo | null {
    if (buffer.length < 10) return null;

    const reader = new BufferReader(buffer);

    try {
        // Magic number
        const magic = reader.u4();
        if (magic !== MAGIC) return null;

        // Version info
        /* const minorVersion = */ reader.u2();
        const majorVersion = reader.u2();

        // Constant pool
        const cpCount = reader.u2();
        const pool = readConstantPool(reader, cpCount);

        // Access flags and class identity
        const accessFlags = reader.u2();
        const thisClassIndex = reader.u2();
        const superClassIndex = reader.u2();

        const className = getClassName(pool, thisClassIndex) ?? '<unknown>';
        const superClassName =
            superClassIndex === 0 ? undefined : getClassName(pool, superClassIndex);

        // Interfaces
        const interfacesCount = reader.u2();
        const interfaces: string[] = [];
        for (let i = 0; i < interfacesCount; i++) {
            const ifaceIndex = reader.u2();
            const ifaceName = getClassName(pool, ifaceIndex);
            if (ifaceName) interfaces.push(ifaceName);
        }

        // Fields
        const fields = readFields(reader, pool);

        // Methods
        const methods = readMethods(reader, pool);

        return {
            className,
            simpleName: qualifiedToSimple(className),
            packageName: qualifiedToPackage(className),
            superClassName,
            interfaces,
            accessFlags,
            isPublic: (accessFlags & ACC_PUBLIC) !== 0,
            isAbstract: (accessFlags & ACC_ABSTRACT) !== 0,
            isInterface: (accessFlags & ACC_INTERFACE) !== 0,
            isEnum: (accessFlags & ACC_ENUM) !== 0,
            isAnnotation: (accessFlags & ACC_ANNOTATION) !== 0,
            fields,
            methods,
            majorVersion,
        };
    } catch {
        // Truncated or malformed class file
        return null;
    }
}
