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

All features are wired into the LSP server and fully functional:

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
- **JDK API model** — 238 built-in JDK types covering core packages (java.lang, java.util, java.io, java.nio, java.net, java.time, java.sql, java.math, java.text, java.util.concurrent, java.util.stream, java.util.function, java.util.regex, java.security)
- **Hover** — symbol signatures + JDK type info + Javadoc from source comments + dependency JAR type info via source JARs
- **Code completion** — scope-aware symbols, JDK types with auto-import, keywords, snippets, overload-aware (each overload shown separately with argument-count ranking)
- **Signature help** — parameter hints for methods in scope, shows all overloads with best-match selection based on argument count
- **Go-to-definition** — local + cross-file via workspace index, import-resolved, source JAR navigation for dependency types
- **Go-to-implementation** — finds subclasses/implementors across workspace
- **Go-to-type-definition** — navigates to type declaration of a variable
- **Find references / Document highlight** — finds matching identifiers, cross-file search
- **Rename** — cross-file rename via workspace index
- **Semantic tokens** — classifies identifiers via symbol table (20 token types, 10 modifiers), generic type parameter classification
- **Code actions** — organize imports, extract variable, extract method, extract constant, inline variable, surround with try-catch, add import for JDK types, move class to package, change method signature
- **Inlay hints** — parameter name hints on method calls, `var` type inference hints (shows inferred type for `var` declarations)
- **Call hierarchy** — incoming/outgoing calls, cross-file via workspace index
- **Classpath resolution** — resolves Maven dependencies via `~/.m2/repository`, Gradle via `~/.gradle/caches`, detects JDK path and version; auto-resolves on workspace init
- **Java class file reader** — parses `.class` files from JARs to extract type metadata (classes, methods, fields, access flags) without a JVM
- **JAR type index** — builds a searchable type index from resolved dependency JARs (ZIP parsing, class extraction, type search)
- **Annotation processing** — Lombok support (`@Data`, `@Getter`, `@Setter`, `@Builder`, `@Value`, `@Slf4j`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@RequiredArgsConstructor`) and Spring annotations (`@Component`, `@Service`, `@RestController`, `@GetMapping`, etc.); integrated into symbol table
- **Document cache** — version-aware caching with debounced reparsing for performance
- **Multi-root workspace** — supports multiple workspace folders, each with its own index; handles `workspace/didChangeWorkspaceFolders`
- **Linked editing ranges** — synchronized editing of all occurrences of an identifier
- **Generics support** — type parameters extracted from classes, interfaces, methods; classified in semantic tokens; bounded type parameter tracking
- **Source JAR navigation** — go-to-definition into dependency source JARs with virtual URI scheme, Javadoc from source JARs in hover

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
| 9. Classpath Resolution | Classpath resolver, class file reader, JDK model, annotation processing | ✅ Done |
| 10. Performance & Polish | Document cache, multi-root workspace, linked editing, document links | ✅ Done |
| 11. Quick Wins | `var` inlay hints, cross-file call hierarchy | ✅ Done |
| 12. Generics Foundation | Type parameters in symbol table, semantic token classification | ✅ Done |
| 13. Overload Resolution | Overload-aware completion, best-match signature help | ✅ Done |
| 14. Advanced Refactoring | Move class to package, change method signature | ✅ Done |
| 15. Source JAR Navigation | Source JAR extraction/caching, go-to-definition into JARs | ✅ Done |

## How It Works

Unlike the [Eclipse JDT Language Server](https://github.com/eclipse-jdtls/eclipse.jdt.ls) which requires a JVM, jj-language-server parses Java source code using [java-parser](https://github.com/jhipster/prettier-java/tree/main/packages/java-parser) (a Chevrotain-based parser written in pure JavaScript) and implements the LSP protocol using [vscode-languageserver](https://github.com/microsoft/vscode-languageserver-node).

## Performance Benchmarks

Benchmarked against Eclipse JDTLS 1.56 on Spring PetClinic (30 Java files), measured via JSON-RPC over stdio:

| Metric | jj-language-server | Eclipse JDTLS |
|---|---|---|
| **Startup time** (initialize handshake) | **~280 ms** | ~1,600 ms (5.9× slower) |
| **Memory after init** (RSS) | **~250 MB** | ~540 MB (2.2× more) |
| **Memory after loading files** (RSS) | **~350 MB** | ~545 MB (1.6× more) |
| **Bulk open** (30 files) | **~1,500 ms** | ~5,000 ms (3.3× slower) |

### Operation Latency (avg of 3 runs, largest file)

| Operation | jj-language-server | Eclipse JDTLS | Notes |
|---|---|---|---|
| `completion` | **1.1 ms** | 3.3 ms | jj 3× faster |
| `documentSymbol` | **0.2 ms** | — | JDTLS needs Maven import |
| `hover` | 2.8 ms | **1.0 ms** | JDTLS faster after warm-up |
| `references` | **9.8 ms** | — | JDTLS needs Maven import |
| `formatting` | **6.8 ms** | — | JDTLS needs Maven import |
| `codeAction` | **1.2 ms** | — | JDTLS needs Maven import |
| `foldingRange` | **2.1 ms** | — | JDTLS needs Maven import |
| `semanticTokens` | 6.4 ms | **0.3 ms** | JDTLS faster after warm-up |

> **Key takeaway:** jj-language-server provides **instant results** with no project import step. JDTLS requires Maven/Gradle dependency resolution (often minutes) before most features work. For cold-start scenarios (opening a project for the first time, CI environments, quick edits), jj-language-server is dramatically faster.

Run benchmarks locally:

```bash
# Download JDTLS, then:
npm run benchmark        # both servers
npm run benchmark:jj     # jj-language-server only
```

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

There are **491 tests** across 35 test files. Integration tests use the [Spring PetClinic](https://github.com/spring-projects/spring-petclinic) project as a realistic fixture. The pinned commit is tracked in `test-fixtures/spring-petclinic-sha.txt`.

### CI / CD

| Workflow | Trigger | Description |
|----------|---------|-------------|
| **CI** (`.github/workflows/ci.yml`) | PR / push to `main` | Lint, build, test (Node 20 & 22) with Spring PetClinic integration |
| **Update Spring PetClinic** (`.github/workflows/update-spring-petclinic.yml`) | Weekly (Monday) / manual | Checks for new PetClinic commits, runs tests, opens a PR |
| **Dependabot** (`.github/dependabot.yml`) | Weekly (Monday) | Updates npm dependencies and GitHub Action versions |

## License

[Apache-2.0](LICENSE)
