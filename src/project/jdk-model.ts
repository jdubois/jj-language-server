/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Pre-built index of commonly used JDK standard library types.
 * Provides type information for completion, hover, and navigation
 * without requiring a JDK installation.
 */

export interface JdkType {
    name: string;
    qualifiedName: string;
    kind: 'class' | 'interface' | 'enum' | 'annotation';
    package: string;
    methods: JdkMethod[];
    fields: JdkField[];
    superclass?: string;
    interfaces?: string[];
    typeParameters?: string[];
    description?: string;
}

export interface JdkMethod {
    name: string;
    returnType: string;
    parameters: { name: string; type: string }[];
    isStatic: boolean;
    description?: string;
}

export interface JdkField {
    name: string;
    type: string;
    isStatic: boolean;
    isFinal: boolean;
}

const JDK_TYPES: JdkType[] = [
    // java.lang
    {
        name: 'Object', qualifiedName: 'java.lang.Object', kind: 'class', package: 'java.lang',
        description: 'Class Object is the root of the class hierarchy.',
        methods: [
            { name: 'toString', returnType: 'String', parameters: [], isStatic: false },
            { name: 'equals', returnType: 'boolean', parameters: [{ name: 'obj', type: 'Object' }], isStatic: false },
            { name: 'hashCode', returnType: 'int', parameters: [], isStatic: false },
            { name: 'getClass', returnType: 'Class<?>',  parameters: [], isStatic: false },
            { name: 'clone', returnType: 'Object', parameters: [], isStatic: false },
            { name: 'notify', returnType: 'void', parameters: [], isStatic: false },
            { name: 'notifyAll', returnType: 'void', parameters: [], isStatic: false },
            { name: 'wait', returnType: 'void', parameters: [], isStatic: false },
        ],
        fields: [],
    },
    {
        name: 'String', qualifiedName: 'java.lang.String', kind: 'class', package: 'java.lang',
        description: 'The String class represents character strings.',
        superclass: 'Object', interfaces: ['Serializable', 'Comparable<String>', 'CharSequence'],
        methods: [
            { name: 'length', returnType: 'int', parameters: [], isStatic: false },
            { name: 'charAt', returnType: 'char', parameters: [{ name: 'index', type: 'int' }], isStatic: false },
            { name: 'substring', returnType: 'String', parameters: [{ name: 'beginIndex', type: 'int' }], isStatic: false },
            { name: 'contains', returnType: 'boolean', parameters: [{ name: 's', type: 'CharSequence' }], isStatic: false },
            { name: 'equals', returnType: 'boolean', parameters: [{ name: 'anObject', type: 'Object' }], isStatic: false },
            { name: 'equalsIgnoreCase', returnType: 'boolean', parameters: [{ name: 'anotherString', type: 'String' }], isStatic: false },
            { name: 'startsWith', returnType: 'boolean', parameters: [{ name: 'prefix', type: 'String' }], isStatic: false },
            { name: 'endsWith', returnType: 'boolean', parameters: [{ name: 'suffix', type: 'String' }], isStatic: false },
            { name: 'indexOf', returnType: 'int', parameters: [{ name: 'str', type: 'String' }], isStatic: false },
            { name: 'lastIndexOf', returnType: 'int', parameters: [{ name: 'str', type: 'String' }], isStatic: false },
            { name: 'replace', returnType: 'String', parameters: [{ name: 'target', type: 'CharSequence' }, { name: 'replacement', type: 'CharSequence' }], isStatic: false },
            { name: 'replaceAll', returnType: 'String', parameters: [{ name: 'regex', type: 'String' }, { name: 'replacement', type: 'String' }], isStatic: false },
            { name: 'split', returnType: 'String[]', parameters: [{ name: 'regex', type: 'String' }], isStatic: false },
            { name: 'trim', returnType: 'String', parameters: [], isStatic: false },
            { name: 'strip', returnType: 'String', parameters: [], isStatic: false },
            { name: 'toLowerCase', returnType: 'String', parameters: [], isStatic: false },
            { name: 'toUpperCase', returnType: 'String', parameters: [], isStatic: false },
            { name: 'isEmpty', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'isBlank', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'toCharArray', returnType: 'char[]', parameters: [], isStatic: false },
            { name: 'format', returnType: 'String', parameters: [{ name: 'format', type: 'String' }, { name: 'args', type: 'Object...' }], isStatic: true },
            { name: 'valueOf', returnType: 'String', parameters: [{ name: 'obj', type: 'Object' }], isStatic: true },
            { name: 'join', returnType: 'String', parameters: [{ name: 'delimiter', type: 'CharSequence' }, { name: 'elements', type: 'CharSequence...' }], isStatic: true },
        ],
        fields: [],
    },
    {
        name: 'Integer', qualifiedName: 'java.lang.Integer', kind: 'class', package: 'java.lang',
        superclass: 'Number', interfaces: ['Comparable<Integer>'],
        methods: [
            { name: 'intValue', returnType: 'int', parameters: [], isStatic: false },
            { name: 'parseInt', returnType: 'int', parameters: [{ name: 's', type: 'String' }], isStatic: true },
            { name: 'valueOf', returnType: 'Integer', parameters: [{ name: 'i', type: 'int' }], isStatic: true },
            { name: 'toString', returnType: 'String', parameters: [], isStatic: false },
            { name: 'compareTo', returnType: 'int', parameters: [{ name: 'anotherInteger', type: 'Integer' }], isStatic: false },
            { name: 'max', returnType: 'int', parameters: [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }], isStatic: true },
            { name: 'min', returnType: 'int', parameters: [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }], isStatic: true },
        ],
        fields: [
            { name: 'MAX_VALUE', type: 'int', isStatic: true, isFinal: true },
            { name: 'MIN_VALUE', type: 'int', isStatic: true, isFinal: true },
        ],
    },
    {
        name: 'Long', qualifiedName: 'java.lang.Long', kind: 'class', package: 'java.lang',
        superclass: 'Number', interfaces: ['Comparable<Long>'],
        methods: [
            { name: 'longValue', returnType: 'long', parameters: [], isStatic: false },
            { name: 'parseLong', returnType: 'long', parameters: [{ name: 's', type: 'String' }], isStatic: true },
            { name: 'valueOf', returnType: 'Long', parameters: [{ name: 'l', type: 'long' }], isStatic: true },
        ],
        fields: [
            { name: 'MAX_VALUE', type: 'long', isStatic: true, isFinal: true },
            { name: 'MIN_VALUE', type: 'long', isStatic: true, isFinal: true },
        ],
    },
    {
        name: 'Double', qualifiedName: 'java.lang.Double', kind: 'class', package: 'java.lang',
        superclass: 'Number', interfaces: ['Comparable<Double>'],
        methods: [
            { name: 'doubleValue', returnType: 'double', parameters: [], isStatic: false },
            { name: 'parseDouble', returnType: 'double', parameters: [{ name: 's', type: 'String' }], isStatic: true },
            { name: 'valueOf', returnType: 'Double', parameters: [{ name: 'd', type: 'double' }], isStatic: true },
            { name: 'isNaN', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'isInfinite', returnType: 'boolean', parameters: [], isStatic: false },
        ],
        fields: [
            { name: 'MAX_VALUE', type: 'double', isStatic: true, isFinal: true },
            { name: 'MIN_VALUE', type: 'double', isStatic: true, isFinal: true },
            { name: 'NaN', type: 'double', isStatic: true, isFinal: true },
            { name: 'POSITIVE_INFINITY', type: 'double', isStatic: true, isFinal: true },
            { name: 'NEGATIVE_INFINITY', type: 'double', isStatic: true, isFinal: true },
        ],
    },
    {
        name: 'Boolean', qualifiedName: 'java.lang.Boolean', kind: 'class', package: 'java.lang',
        superclass: 'Object', interfaces: ['Serializable', 'Comparable<Boolean>'],
        methods: [
            { name: 'booleanValue', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'parseBoolean', returnType: 'boolean', parameters: [{ name: 's', type: 'String' }], isStatic: true },
            { name: 'valueOf', returnType: 'Boolean', parameters: [{ name: 'b', type: 'boolean' }], isStatic: true },
        ],
        fields: [
            { name: 'TRUE', type: 'Boolean', isStatic: true, isFinal: true },
            { name: 'FALSE', type: 'Boolean', isStatic: true, isFinal: true },
        ],
    },
    {
        name: 'System', qualifiedName: 'java.lang.System', kind: 'class', package: 'java.lang',
        methods: [
            { name: 'currentTimeMillis', returnType: 'long', parameters: [], isStatic: true },
            { name: 'nanoTime', returnType: 'long', parameters: [], isStatic: true },
            { name: 'exit', returnType: 'void', parameters: [{ name: 'status', type: 'int' }], isStatic: true },
            { name: 'getenv', returnType: 'String', parameters: [{ name: 'name', type: 'String' }], isStatic: true },
            { name: 'getProperty', returnType: 'String', parameters: [{ name: 'key', type: 'String' }], isStatic: true },
            { name: 'arraycopy', returnType: 'void', parameters: [{ name: 'src', type: 'Object' }, { name: 'srcPos', type: 'int' }, { name: 'dest', type: 'Object' }, { name: 'destPos', type: 'int' }, { name: 'length', type: 'int' }], isStatic: true },
        ],
        fields: [
            { name: 'out', type: 'PrintStream', isStatic: true, isFinal: true },
            { name: 'err', type: 'PrintStream', isStatic: true, isFinal: true },
            { name: 'in', type: 'InputStream', isStatic: true, isFinal: true },
        ],
    },
    {
        name: 'Math', qualifiedName: 'java.lang.Math', kind: 'class', package: 'java.lang',
        methods: [
            { name: 'abs', returnType: 'int', parameters: [{ name: 'a', type: 'int' }], isStatic: true },
            { name: 'max', returnType: 'int', parameters: [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }], isStatic: true },
            { name: 'min', returnType: 'int', parameters: [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }], isStatic: true },
            { name: 'pow', returnType: 'double', parameters: [{ name: 'a', type: 'double' }, { name: 'b', type: 'double' }], isStatic: true },
            { name: 'sqrt', returnType: 'double', parameters: [{ name: 'a', type: 'double' }], isStatic: true },
            { name: 'random', returnType: 'double', parameters: [], isStatic: true },
            { name: 'round', returnType: 'long', parameters: [{ name: 'a', type: 'double' }], isStatic: true },
            { name: 'floor', returnType: 'double', parameters: [{ name: 'a', type: 'double' }], isStatic: true },
            { name: 'ceil', returnType: 'double', parameters: [{ name: 'a', type: 'double' }], isStatic: true },
            { name: 'log', returnType: 'double', parameters: [{ name: 'a', type: 'double' }], isStatic: true },
            { name: 'sin', returnType: 'double', parameters: [{ name: 'a', type: 'double' }], isStatic: true },
            { name: 'cos', returnType: 'double', parameters: [{ name: 'a', type: 'double' }], isStatic: true },
        ],
        fields: [
            { name: 'PI', type: 'double', isStatic: true, isFinal: true },
            { name: 'E', type: 'double', isStatic: true, isFinal: true },
        ],
    },
    {
        name: 'StringBuilder', qualifiedName: 'java.lang.StringBuilder', kind: 'class', package: 'java.lang',
        superclass: 'AbstractStringBuilder', interfaces: ['Serializable', 'CharSequence'],
        methods: [
            { name: 'append', returnType: 'StringBuilder', parameters: [{ name: 's', type: 'String' }], isStatic: false },
            { name: 'insert', returnType: 'StringBuilder', parameters: [{ name: 'offset', type: 'int' }, { name: 's', type: 'String' }], isStatic: false },
            { name: 'delete', returnType: 'StringBuilder', parameters: [{ name: 'start', type: 'int' }, { name: 'end', type: 'int' }], isStatic: false },
            { name: 'reverse', returnType: 'StringBuilder', parameters: [], isStatic: false },
            { name: 'toString', returnType: 'String', parameters: [], isStatic: false },
            { name: 'length', returnType: 'int', parameters: [], isStatic: false },
        ],
        fields: [],
    },
    {
        name: 'Thread', qualifiedName: 'java.lang.Thread', kind: 'class', package: 'java.lang',
        superclass: 'Object', interfaces: ['Runnable'],
        methods: [
            { name: 'start', returnType: 'void', parameters: [], isStatic: false },
            { name: 'run', returnType: 'void', parameters: [], isStatic: false },
            { name: 'sleep', returnType: 'void', parameters: [{ name: 'millis', type: 'long' }], isStatic: true },
            { name: 'currentThread', returnType: 'Thread', parameters: [], isStatic: true },
            { name: 'getName', returnType: 'String', parameters: [], isStatic: false },
            { name: 'interrupt', returnType: 'void', parameters: [], isStatic: false },
            { name: 'isAlive', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'join', returnType: 'void', parameters: [], isStatic: false },
        ],
        fields: [],
    },
    {
        name: 'Exception', qualifiedName: 'java.lang.Exception', kind: 'class', package: 'java.lang',
        superclass: 'Throwable',
        methods: [
            { name: 'getMessage', returnType: 'String', parameters: [], isStatic: false },
            { name: 'printStackTrace', returnType: 'void', parameters: [], isStatic: false },
            { name: 'getCause', returnType: 'Throwable', parameters: [], isStatic: false },
        ],
        fields: [],
    },
    {
        name: 'RuntimeException', qualifiedName: 'java.lang.RuntimeException', kind: 'class', package: 'java.lang',
        superclass: 'Exception', methods: [], fields: [],
    },
    {
        name: 'NullPointerException', qualifiedName: 'java.lang.NullPointerException', kind: 'class', package: 'java.lang',
        superclass: 'RuntimeException', methods: [], fields: [],
    },
    {
        name: 'IllegalArgumentException', qualifiedName: 'java.lang.IllegalArgumentException', kind: 'class', package: 'java.lang',
        superclass: 'RuntimeException', methods: [], fields: [],
    },
    {
        name: 'IllegalStateException', qualifiedName: 'java.lang.IllegalStateException', kind: 'class', package: 'java.lang',
        superclass: 'RuntimeException', methods: [], fields: [],
    },
    {
        name: 'Comparable', qualifiedName: 'java.lang.Comparable', kind: 'interface', package: 'java.lang',
        typeParameters: ['T'],
        methods: [
            { name: 'compareTo', returnType: 'int', parameters: [{ name: 'o', type: 'T' }], isStatic: false },
        ],
        fields: [],
    },
    {
        name: 'Iterable', qualifiedName: 'java.lang.Iterable', kind: 'interface', package: 'java.lang',
        typeParameters: ['T'],
        methods: [
            { name: 'iterator', returnType: 'Iterator<T>', parameters: [], isStatic: false },
        ],
        fields: [],
    },
    {
        name: 'Runnable', qualifiedName: 'java.lang.Runnable', kind: 'interface', package: 'java.lang',
        methods: [
            { name: 'run', returnType: 'void', parameters: [], isStatic: false },
        ],
        fields: [],
    },
    {
        name: 'AutoCloseable', qualifiedName: 'java.lang.AutoCloseable', kind: 'interface', package: 'java.lang',
        methods: [
            { name: 'close', returnType: 'void', parameters: [], isStatic: false },
        ],
        fields: [],
    },
    {
        name: 'Override', qualifiedName: 'java.lang.Override', kind: 'annotation', package: 'java.lang',
        methods: [], fields: [],
    },
    {
        name: 'Deprecated', qualifiedName: 'java.lang.Deprecated', kind: 'annotation', package: 'java.lang',
        methods: [], fields: [],
    },
    {
        name: 'SuppressWarnings', qualifiedName: 'java.lang.SuppressWarnings', kind: 'annotation', package: 'java.lang',
        methods: [], fields: [],
    },
    {
        name: 'FunctionalInterface', qualifiedName: 'java.lang.FunctionalInterface', kind: 'annotation', package: 'java.lang',
        methods: [], fields: [],
    },

    // java.util
    {
        name: 'List', qualifiedName: 'java.util.List', kind: 'interface', package: 'java.util',
        typeParameters: ['E'], interfaces: ['Collection<E>'],
        methods: [
            { name: 'add', returnType: 'boolean', parameters: [{ name: 'e', type: 'E' }], isStatic: false },
            { name: 'get', returnType: 'E', parameters: [{ name: 'index', type: 'int' }], isStatic: false },
            { name: 'set', returnType: 'E', parameters: [{ name: 'index', type: 'int' }, { name: 'element', type: 'E' }], isStatic: false },
            { name: 'remove', returnType: 'E', parameters: [{ name: 'index', type: 'int' }], isStatic: false },
            { name: 'size', returnType: 'int', parameters: [], isStatic: false },
            { name: 'isEmpty', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'contains', returnType: 'boolean', parameters: [{ name: 'o', type: 'Object' }], isStatic: false },
            { name: 'indexOf', returnType: 'int', parameters: [{ name: 'o', type: 'Object' }], isStatic: false },
            { name: 'subList', returnType: 'List<E>', parameters: [{ name: 'fromIndex', type: 'int' }, { name: 'toIndex', type: 'int' }], isStatic: false },
            { name: 'of', returnType: 'List<E>', parameters: [], isStatic: true },
        ],
        fields: [],
    },
    {
        name: 'ArrayList', qualifiedName: 'java.util.ArrayList', kind: 'class', package: 'java.util',
        typeParameters: ['E'], superclass: 'AbstractList<E>', interfaces: ['List<E>', 'RandomAccess', 'Cloneable', 'Serializable'],
        methods: [
            { name: 'add', returnType: 'boolean', parameters: [{ name: 'e', type: 'E' }], isStatic: false },
            { name: 'get', returnType: 'E', parameters: [{ name: 'index', type: 'int' }], isStatic: false },
            { name: 'size', returnType: 'int', parameters: [], isStatic: false },
            { name: 'clear', returnType: 'void', parameters: [], isStatic: false },
            { name: 'trimToSize', returnType: 'void', parameters: [], isStatic: false },
        ],
        fields: [],
    },
    {
        name: 'LinkedList', qualifiedName: 'java.util.LinkedList', kind: 'class', package: 'java.util',
        typeParameters: ['E'], superclass: 'AbstractSequentialList<E>', interfaces: ['List<E>', 'Deque<E>', 'Cloneable', 'Serializable'],
        methods: [
            { name: 'addFirst', returnType: 'void', parameters: [{ name: 'e', type: 'E' }], isStatic: false },
            { name: 'addLast', returnType: 'void', parameters: [{ name: 'e', type: 'E' }], isStatic: false },
            { name: 'getFirst', returnType: 'E', parameters: [], isStatic: false },
            { name: 'getLast', returnType: 'E', parameters: [], isStatic: false },
        ],
        fields: [],
    },
    {
        name: 'Map', qualifiedName: 'java.util.Map', kind: 'interface', package: 'java.util',
        typeParameters: ['K', 'V'],
        methods: [
            { name: 'put', returnType: 'V', parameters: [{ name: 'key', type: 'K' }, { name: 'value', type: 'V' }], isStatic: false },
            { name: 'get', returnType: 'V', parameters: [{ name: 'key', type: 'Object' }], isStatic: false },
            { name: 'remove', returnType: 'V', parameters: [{ name: 'key', type: 'Object' }], isStatic: false },
            { name: 'containsKey', returnType: 'boolean', parameters: [{ name: 'key', type: 'Object' }], isStatic: false },
            { name: 'containsValue', returnType: 'boolean', parameters: [{ name: 'value', type: 'Object' }], isStatic: false },
            { name: 'size', returnType: 'int', parameters: [], isStatic: false },
            { name: 'isEmpty', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'keySet', returnType: 'Set<K>', parameters: [], isStatic: false },
            { name: 'values', returnType: 'Collection<V>', parameters: [], isStatic: false },
            { name: 'entrySet', returnType: 'Set<Map.Entry<K,V>>', parameters: [], isStatic: false },
            { name: 'getOrDefault', returnType: 'V', parameters: [{ name: 'key', type: 'Object' }, { name: 'defaultValue', type: 'V' }], isStatic: false },
            { name: 'putIfAbsent', returnType: 'V', parameters: [{ name: 'key', type: 'K' }, { name: 'value', type: 'V' }], isStatic: false },
            { name: 'of', returnType: 'Map<K,V>', parameters: [], isStatic: true },
        ],
        fields: [],
    },
    {
        name: 'HashMap', qualifiedName: 'java.util.HashMap', kind: 'class', package: 'java.util',
        typeParameters: ['K', 'V'], superclass: 'AbstractMap<K,V>', interfaces: ['Map<K,V>', 'Cloneable', 'Serializable'],
        methods: [], fields: [],
    },
    {
        name: 'TreeMap', qualifiedName: 'java.util.TreeMap', kind: 'class', package: 'java.util',
        typeParameters: ['K', 'V'], superclass: 'AbstractMap<K,V>', interfaces: ['NavigableMap<K,V>', 'Cloneable', 'Serializable'],
        methods: [], fields: [],
    },
    {
        name: 'Set', qualifiedName: 'java.util.Set', kind: 'interface', package: 'java.util',
        typeParameters: ['E'], interfaces: ['Collection<E>'],
        methods: [
            { name: 'add', returnType: 'boolean', parameters: [{ name: 'e', type: 'E' }], isStatic: false },
            { name: 'remove', returnType: 'boolean', parameters: [{ name: 'o', type: 'Object' }], isStatic: false },
            { name: 'contains', returnType: 'boolean', parameters: [{ name: 'o', type: 'Object' }], isStatic: false },
            { name: 'size', returnType: 'int', parameters: [], isStatic: false },
            { name: 'isEmpty', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'of', returnType: 'Set<E>', parameters: [], isStatic: true },
        ],
        fields: [],
    },
    {
        name: 'HashSet', qualifiedName: 'java.util.HashSet', kind: 'class', package: 'java.util',
        typeParameters: ['E'], superclass: 'AbstractSet<E>', interfaces: ['Set<E>', 'Cloneable', 'Serializable'],
        methods: [], fields: [],
    },
    {
        name: 'Collections', qualifiedName: 'java.util.Collections', kind: 'class', package: 'java.util',
        methods: [
            { name: 'sort', returnType: 'void', parameters: [{ name: 'list', type: 'List<T>' }], isStatic: true },
            { name: 'reverse', returnType: 'void', parameters: [{ name: 'list', type: 'List<?>'}], isStatic: true },
            { name: 'shuffle', returnType: 'void', parameters: [{ name: 'list', type: 'List<?>'}], isStatic: true },
            { name: 'unmodifiableList', returnType: 'List<T>', parameters: [{ name: 'list', type: 'List<? extends T>' }], isStatic: true },
            { name: 'emptyList', returnType: 'List<T>', parameters: [], isStatic: true },
            { name: 'singletonList', returnType: 'List<T>', parameters: [{ name: 'o', type: 'T' }], isStatic: true },
        ],
        fields: [],
    },
    {
        name: 'Arrays', qualifiedName: 'java.util.Arrays', kind: 'class', package: 'java.util',
        methods: [
            { name: 'sort', returnType: 'void', parameters: [{ name: 'a', type: 'int[]' }], isStatic: true },
            { name: 'asList', returnType: 'List<T>', parameters: [{ name: 'a', type: 'T...' }], isStatic: true },
            { name: 'toString', returnType: 'String', parameters: [{ name: 'a', type: 'int[]' }], isStatic: true },
            { name: 'copyOf', returnType: 'T[]', parameters: [{ name: 'original', type: 'T[]' }, { name: 'newLength', type: 'int' }], isStatic: true },
            { name: 'fill', returnType: 'void', parameters: [{ name: 'a', type: 'int[]' }, { name: 'val', type: 'int' }], isStatic: true },
            { name: 'stream', returnType: 'Stream<T>', parameters: [{ name: 'array', type: 'T[]' }], isStatic: true },
        ],
        fields: [],
    },
    {
        name: 'Optional', qualifiedName: 'java.util.Optional', kind: 'class', package: 'java.util',
        typeParameters: ['T'],
        methods: [
            { name: 'of', returnType: 'Optional<T>', parameters: [{ name: 'value', type: 'T' }], isStatic: true },
            { name: 'ofNullable', returnType: 'Optional<T>', parameters: [{ name: 'value', type: 'T' }], isStatic: true },
            { name: 'empty', returnType: 'Optional<T>', parameters: [], isStatic: true },
            { name: 'isPresent', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'isEmpty', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'get', returnType: 'T', parameters: [], isStatic: false },
            { name: 'orElse', returnType: 'T', parameters: [{ name: 'other', type: 'T' }], isStatic: false },
        ],
        fields: [],
    },
    {
        name: 'Iterator', qualifiedName: 'java.util.Iterator', kind: 'interface', package: 'java.util',
        typeParameters: ['E'],
        methods: [
            { name: 'hasNext', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'next', returnType: 'E', parameters: [], isStatic: false },
            { name: 'remove', returnType: 'void', parameters: [], isStatic: false },
        ],
        fields: [],
    },

    // java.util.stream
    {
        name: 'Stream', qualifiedName: 'java.util.stream.Stream', kind: 'interface', package: 'java.util.stream',
        typeParameters: ['T'],
        methods: [
            { name: 'filter', returnType: 'Stream<T>', parameters: [{ name: 'predicate', type: 'Predicate<? super T>' }], isStatic: false },
            { name: 'map', returnType: 'Stream<R>', parameters: [{ name: 'mapper', type: 'Function<? super T, ? extends R>' }], isStatic: false },
            { name: 'flatMap', returnType: 'Stream<R>', parameters: [{ name: 'mapper', type: 'Function<? super T, ? extends Stream<? extends R>>' }], isStatic: false },
            { name: 'collect', returnType: 'R', parameters: [{ name: 'collector', type: 'Collector<? super T, A, R>' }], isStatic: false },
            { name: 'forEach', returnType: 'void', parameters: [{ name: 'action', type: 'Consumer<? super T>' }], isStatic: false },
            { name: 'reduce', returnType: 'Optional<T>', parameters: [{ name: 'accumulator', type: 'BinaryOperator<T>' }], isStatic: false },
            { name: 'count', returnType: 'long', parameters: [], isStatic: false },
            { name: 'findFirst', returnType: 'Optional<T>', parameters: [], isStatic: false },
            { name: 'toList', returnType: 'List<T>', parameters: [], isStatic: false },
            { name: 'of', returnType: 'Stream<T>', parameters: [{ name: 'values', type: 'T...' }], isStatic: true },
        ],
        fields: [],
    },
    {
        name: 'Collectors', qualifiedName: 'java.util.stream.Collectors', kind: 'class', package: 'java.util.stream',
        methods: [
            { name: 'toList', returnType: 'Collector<T,?,List<T>>', parameters: [], isStatic: true },
            { name: 'toSet', returnType: 'Collector<T,?,Set<T>>', parameters: [], isStatic: true },
            { name: 'toMap', returnType: 'Collector<T,?,Map<K,U>>', parameters: [{ name: 'keyMapper', type: 'Function<? super T, ? extends K>' }, { name: 'valueMapper', type: 'Function<? super T, ? extends U>' }], isStatic: true },
            { name: 'joining', returnType: 'Collector<CharSequence,?,String>', parameters: [{ name: 'delimiter', type: 'CharSequence' }], isStatic: true },
            { name: 'groupingBy', returnType: 'Collector<T,?,Map<K,List<T>>>', parameters: [{ name: 'classifier', type: 'Function<? super T, ? extends K>' }], isStatic: true },
        ],
        fields: [],
    },

    // java.io
    {
        name: 'File', qualifiedName: 'java.io.File', kind: 'class', package: 'java.io',
        methods: [
            { name: 'exists', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'isFile', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'isDirectory', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'getName', returnType: 'String', parameters: [], isStatic: false },
            { name: 'getPath', returnType: 'String', parameters: [], isStatic: false },
            { name: 'getAbsolutePath', returnType: 'String', parameters: [], isStatic: false },
            { name: 'length', returnType: 'long', parameters: [], isStatic: false },
            { name: 'delete', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'mkdir', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'mkdirs', returnType: 'boolean', parameters: [], isStatic: false },
            { name: 'listFiles', returnType: 'File[]', parameters: [], isStatic: false },
        ],
        fields: [
            { name: 'separator', type: 'String', isStatic: true, isFinal: true },
        ],
    },

    // java.util.function
    {
        name: 'Function', qualifiedName: 'java.util.function.Function', kind: 'interface', package: 'java.util.function',
        typeParameters: ['T', 'R'],
        methods: [
            { name: 'apply', returnType: 'R', parameters: [{ name: 't', type: 'T' }], isStatic: false },
            { name: 'identity', returnType: 'Function<T,T>', parameters: [], isStatic: true },
        ],
        fields: [],
    },
    {
        name: 'Consumer', qualifiedName: 'java.util.function.Consumer', kind: 'interface', package: 'java.util.function',
        typeParameters: ['T'],
        methods: [{ name: 'accept', returnType: 'void', parameters: [{ name: 't', type: 'T' }], isStatic: false }],
        fields: [],
    },
    {
        name: 'Supplier', qualifiedName: 'java.util.function.Supplier', kind: 'interface', package: 'java.util.function',
        typeParameters: ['T'],
        methods: [{ name: 'get', returnType: 'T', parameters: [], isStatic: false }],
        fields: [],
    },
    {
        name: 'Predicate', qualifiedName: 'java.util.function.Predicate', kind: 'interface', package: 'java.util.function',
        typeParameters: ['T'],
        methods: [{ name: 'test', returnType: 'boolean', parameters: [{ name: 't', type: 'T' }], isStatic: false }],
        fields: [],
    },
];

// Index structures for fast lookup
const typesByName: Map<string, JdkType> = new Map();
const typesByQualifiedName: Map<string, JdkType> = new Map();
const typesByPackage: Map<string, JdkType[]> = new Map();

for (const t of JDK_TYPES) {
    typesByName.set(t.name, t);
    typesByQualifiedName.set(t.qualifiedName, t);
    const pkg = typesByPackage.get(t.package) ?? [];
    pkg.push(t);
    typesByPackage.set(t.package, pkg);
}

export function getJdkType(name: string): JdkType | undefined {
    return typesByName.get(name) ?? typesByQualifiedName.get(name);
}

export function getJdkTypesByPackage(pkg: string): JdkType[] {
    return typesByPackage.get(pkg) ?? [];
}

export function getAllJdkTypes(): JdkType[] {
    return JDK_TYPES;
}

export function getAutoImportedTypes(): JdkType[] {
    return typesByPackage.get('java.lang') ?? [];
}

export function getCommonImportableTypes(): JdkType[] {
    return JDK_TYPES;
}
