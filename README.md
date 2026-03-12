# jj-language-server

A Java Language Server implemented in TypeScript/JavaScript — **no JVM required**.

Installable via npm, works with any editor that supports the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).

## Installing

```sh
npm install -g jj-language-server
```

## Running

```sh
jj-language-server --stdio
```

## CLI Options

```
Usage: jj-language-server [options]

Options:
  -V, --version                output the version number
  --stdio                      use stdio (required)
  --log-level <logLevel>       Log level: 4=log, 3=info, 2=warn, 1=error (default: 3)
  -h, --help                   display help for command
```

## Features

### ✅ Fully Implemented

- **Document symbols** — hierarchical: classes, methods, fields, constructors, enums, records, interfaces, annotations
- **Workspace symbols** — search across all indexed Java files
- **Code folding** — blocks, methods, imports, comments, annotations
- **Code formatting** — via Prettier Java, with on-type formatting (auto-indent, auto-close braces)
- **Selection range** — smart expand/shrink via CST hierarchy
- **Code lens** — reference counts above declarations
- **Source generation** — generate constructors, getters/setters, toString, equals/hashCode (real TextEdit insertions)
- **Diagnostics** — parse errors, duplicate declarations, unused imports, missing return statements, unreachable code, unresolved type references, deprecated API warnings (`@Deprecated`), unresolved method detection, access control violations, missing `@Override` hints
- **Maven/Gradle parsing** — extracts project metadata, dependencies, source directories, Java version
- **Javadoc** — parses `/** */` comments, renders in hover & completion
- **Type hierarchy** — real supertypes/subtypes using symbol table
- **File watcher** — `workspace/didChangeWatchedFiles` to re-index on external changes
- **Workspace configuration** — settings for formatter, Java version, classpath hints
- **Import resolution** — resolves `import` statements, maps unqualified names throughout the file
- **Type inference** — local variable types, expression types (method calls, field access, literals, operators), type resolver for symbols, members, method return types, field types

### 🟡 Partially Implemented

These features work but have some remaining limitations:

- **Hover** — symbol signatures + JDK type info + Javadoc from source comments (no dependency JAR Javadoc)
- **Code completion** — scope-aware symbols, JDK types with auto-import, keywords, snippets (no overload resolution)
- **Signature help** — parameter hints for local methods (no JDK method signatures)
- **Go-to-definition** — local + cross-file via workspace index, import-resolved (no dependency JAR navigation)
- **Go-to-implementation** — finds subclasses/implementors in workspace
- **Go-to-type-definition** — navigates to type declaration of a variable
- **Find references / Document highlight** — finds matching identifiers (no qualified access like `this.x`)
- **Rename** — cross-file rename (no type-aware disambiguation)
- **Semantic tokens** — classifies identifiers via symbol table (no generic type params)
- **Inlay hints** — parameter name hints on method calls (no inferred type hints for `var`)
- **Call hierarchy** — incoming/outgoing calls (single-file only)
- **Code actions** — organize imports, extract variable, extract method, extract constant, inline variable, surround with try-catch, add import

### ❌ Not Yet Implemented

- **Generics & overload resolution** — generic type parameters, bounded wildcards, overloaded method selection
- **Advanced refactoring** — move class, change method signature
- **Classpath resolution** — dependency JAR analysis, source JAR navigation, full JDK API model
- **Annotation processing** — Lombok, MapStruct, etc.
- **Incremental parsing** — currently full reparse on every change

### Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| 1. Semantic Diagnostics | Parse-level semantic checks | ✅ Done |
| 2. Source Generation | Constructor, getters/setters, toString, equals/hashCode | ✅ Done |
| 3. Enhanced Features | Real code action edits, semantic tokens, cross-file rename | ✅ Done |
| 4. Navigation | Go-to-implementation, type definition, improved cross-file def | ✅ Done |
| 5. Quick Wins | Javadoc extraction, type hierarchy wiring, file watcher, workspace config | ✅ Done |
| 6. Type Resolution | Import resolution, local type inference, expression types, type resolver | ✅ Done |
| 7. Advanced Diagnostics | Deprecated warnings, unresolved methods, access control, missing @Override | ✅ Done |
| 8. Advanced Refactoring | Extract method, extract constant, inline variable | ✅ Done |
| 9. Classpath Resolution | Dependency JARs, full JDK model, source navigation | 🔲 Planned |

## How It Works

Unlike the [Eclipse JDT Language Server](https://github.com/eclipse-jdtls/eclipse.jdt.ls) which requires a JVM, jj-language-server parses Java source code using [java-parser](https://github.com/jhipster/prettier-java/tree/main/packages/java-parser) (a Chevrotain-based parser written in pure JavaScript) and implements the LSP protocol using [vscode-languageserver](https://github.com/microsoft/vscode-languageserver-node).

## Development

### Build

```sh
npm install
npm run build
```

### Test

```sh
npm test
```

There are **280 tests** across 23 test files. Integration tests use the [Spring PetClinic](https://github.com/spring-projects/spring-petclinic) project as a realistic fixture. The pinned commit is tracked in `test-fixtures/spring-petclinic-sha.txt`.

### CI / CD

| Workflow | Trigger | Description |
|----------|---------|-------------|
| **CI** (`.github/workflows/ci.yml`) | PR / push to `main` | Lint, build, test (Node 20 & 22) with Spring PetClinic integration |
| **Update Spring PetClinic** (`.github/workflows/update-spring-petclinic.yml`) | Weekly (Monday) / manual | Checks for new PetClinic commits, runs tests, opens a PR |
| **Dependabot** (`.github/dependabot.yml`) | Weekly (Monday) | Updates npm dependencies and GitHub Action versions |

## License

[Apache-2.0](LICENSE)
