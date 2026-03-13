# Copilot Instructions for jj-language-server

## Build, Test, and Lint

```sh
npm run build          # Clean build via Rollup → lib/cli.mjs
npm run dev            # Build with --watch
npm test               # Vitest in watch mode
npm run test:run       # Single Vitest run (CI)
npm run lint           # ESLint on src/
npm run fix            # ESLint auto-fix
```

Run a single test file:

```sh
npx vitest run src/features/completion.test.ts
```

Run a single test by name:

```sh
npx vitest run -t "should include class members"
```

## Architecture

This is a **Java Language Server implemented in TypeScript** aiming for feature parity with [Eclipse JDT Language Server](https://github.com/eclipse-jdtls/eclipse.jdt.ls), but **without requiring a JVM**. It uses the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) over stdio, and can be installed as a single npm package.

### Parsing Pipeline

1. **`java/parser.ts`** — Wraps `java-parser` (Chevrotain-based) to produce a CST (`CstNode`) and parse errors (`ParseResult`)
2. **`java/symbol-table.ts`** — Walks the CST to build a `SymbolTable` containing hierarchical `JavaSymbol` objects (classes, methods, fields, variables, etc.)
3. **`java/scope-resolver.ts`** — Resolves symbols by position and visibility scope, used by features for name resolution
4. **`java/cst-utils.ts`** — Low-level CST traversal helpers (find first/last token, collect tokens, position utilities)
5. **`java/import-resolver.ts`** — Builds import maps from CST, resolves type names via imports and `java.lang` auto-imports
6. **`java/type-resolver.ts`** — Type inference engine: resolves type strings, symbol types, type members, method return types, field types
7. **`java/expression-type-resolver.ts`** — Expression-level type inference: literals, identifiers, method calls, field access, operators, `this`/`super`, `new`, casts
8. **`java/javadoc.ts`** — Parses `/** */` Javadoc comments, extracts `@param`/`@return`/`@throws`/`@since`/`@deprecated` tags, renders as Markdown

### LSP Wiring

- **`cli.ts`** — Entry point. Parses CLI args, creates the LSP connection
- **`lsp-connection.ts`** — Creates the `vscode-languageserver` connection and binds all LSP request handlers to `LspServer` methods
- **`lsp-server.ts`** — Central orchestrator. Manages per-file state (`documents`, `parseResults`, `symbolTables`) and delegates to feature modules. On every document change, it re-parses and re-builds the symbol table
- **`lsp-client.ts`** — Thin wrapper over the LSP connection for sending notifications (diagnostics, messages)

### Feature Modules (`features/`)

Each LSP feature is a standalone module exporting pure functions. Features receive the CST, SymbolTable, and/or document text — they do not access LspServer state directly. The pattern is:

```typescript
export function provideFeature(cst: CstNode, table: SymbolTable, ...args): ResultType
```

### Project Intelligence (`project/`)

- **`workspace-index.ts`** — `WorkspaceIndex` class that scans the workspace for `.java` files, indexes them, and provides cross-file symbol resolution (used for go-to-definition across files, workspace symbols)
- **`jdk-model.ts`** — Hardcoded index of common JDK standard library types with their methods, fields, and descriptions. Enables completion/hover for `String`, `List`, `Map`, etc. without a JDK
- **`maven.ts`** / **`gradle.ts`** — Parse `pom.xml` and `build.gradle`/`.kts` files to extract project metadata (Java version, dependencies, modules)

## Key Conventions

### Coordinate Systems

Chevrotain tokens use **1-based** lines/columns. LSP uses **0-based**. Conversion happens at feature boundaries — the `SymbolTable` stores **0-based** positions, while raw `IToken` positions are **1-based**.

### Feature Module Pattern

Features are pure functions that receive data and return LSP types. They never hold state or reference `LspServer`. New features should follow this pattern and be wired in `lsp-connection.ts`.

### Testing Pattern

Tests use Vitest with `describe`/`it`/`expect`. The typical pattern for testing features:

1. Define a Java source string inline
2. Parse it with `parseJava()` to get a CST
3. Build a `SymbolTable` with `buildSymbolTable()`
4. Call the feature function and assert on the result

Tests are colocated with their source files (e.g., `completion.ts` → `completion.test.ts`).

### Module System

The project uses **ES modules** (`"type": "module"` in package.json). Imports use `.js` extensions even for TypeScript files (standard for ESM + TypeScript). Rollup bundles everything into a single `lib/cli.mjs` file.

### Copyright Headers

Every source file starts with the Apache 2.0 copyright header for "jj-language-server contributors".

### README Roadmap

When a new feature is implemented, **always update the README.md** to reflect it:
- Move features from ❌/🟡 to ✅ as they become fully implemented
- Update the roadmap table with phase completion status
- Update the test count in the Development section
- This ensures the README is always an accurate reflection of the project's capabilities

## Roadmap to JDTLS Feature Parity

The goal is full feature parity with Eclipse JDT Language Server, without requiring a JVM.

### Current Status

All 10 implementation phases are complete. The project has a full parsing pipeline (java-parser → CST → SymbolTable), a type inference engine, import/expression resolution, Javadoc extraction, comprehensive semantic diagnostics, classpath resolution, annotation processing, and performance features. **443 tests pass** across 31 test files, including 64 integration tests against Spring PetClinic.

**Done:** Document symbols, workspace symbols, document highlight, folding ranges, selection ranges, organize imports, semantic diagnostics (duplicate declarations, unused imports, missing returns, unreachable code, unresolved types, deprecated usage, access control, missing @Override), source generation (constructors, getters/setters, toString, equals/hashCode, override stubs), completion with auto-import and Javadoc, hover with Javadoc, go-to-definition (cross-file), references, rename, semantic tokens (context-aware), code actions, formatting (via Prettier), signature help, inlay hints, call/type hierarchy, go-to-implementation, type definition, import resolution, type inference, expression type resolution, extract method/constant, inline variable, file watcher, workspace configuration, classpath resolution (Maven/Gradle), Java class file reader, JAR type index, annotation processing (Lombok/Spring), expanded JDK model (238 types), document cache, multi-root workspace, linked editing, document links.

**Remaining gaps:** Generics & overload resolution, source JAR navigation, advanced refactoring (move class, change method signature).

### Completed Phases

1. ✅ **Semantic Diagnostics** — duplicate declarations, unused imports, missing returns, unreachable code, unresolved types
2. ✅ **Source Generation** — constructors, getters/setters, toString, equals/hashCode, override stubs
3. ✅ **Enhanced Features** — real code action edits, semantic tokens, cross-file rename, completion auto-import, on-type formatting
4. ✅ **Navigation** — go-to-implementation, type definition, improved cross-file definition, references fallback
5. ✅ **Javadoc & Infrastructure** — Javadoc extraction/display, type hierarchy, file watcher, workspace configuration
6. ✅ **Type System** — import resolution, type resolver, expression type inference, local variable types
7. ✅ **Advanced Diagnostics** — deprecated usage warnings, unresolved method detection, access control violations, missing @Override hints
8. ✅ **Refactoring** — extract method, extract constant, inline variable

### Remaining Phases

9. ✅ **Classpath & Dependency Resolution** — Maven/Gradle classpath resolution, Java class file reader, expanded JDK model (200+ types), Lombok/Spring annotation processing
10. ✅ **Performance & Polish** — document cache with debounced reparsing, multi-root workspace, linked editing ranges, document links

### Remaining Gaps (not in any phase)

- Generics & overload resolution (generic type parameters, bounded wildcards)
- Source JAR navigation (go-to-definition into dependency sources)
- Advanced refactoring (move class, change method signature)
