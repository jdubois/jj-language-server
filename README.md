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

### Implemented

- **Diagnostics** — syntax errors, unresolved type references, duplicate declarations, unused imports, missing return statements, unreachable code
- **Document symbols** — classes, methods, fields, constructors extracted from CST
- **Workspace symbols** — search across all indexed Java files
- **Code folding** — block-based folding
- **Code formatting** — via Prettier Java, with on-type formatting (auto-indent, auto-close braces)
- **Hover** — symbol signatures and JDK type info
- **Code completion** — scope-aware symbols, JDK types with auto-import, keywords, snippets
- **Signature help** — parameter hints for methods
- **Go-to-definition** — local + cross-file via workspace index
- **Find references** — cross-file via workspace index
- **Document highlight** — all occurrences with read/write distinction
- **Rename** — cross-file rename via workspace index
- **Selection range** — smart expand/shrink via CST
- **Semantic highlighting** — keywords, literals, operators, and contextual identifier classification (class/method/field/parameter/variable)
- **Code actions** — organize imports, extract variable, surround with try-catch, add import for JDK types (all produce real edits)
- **Source generation** — generate constructors, getters/setters, toString, equals/hashCode
- **Inlay hints** — based on local symbol info
- **Call hierarchy** — incoming/outgoing calls (single-file)
- **Type hierarchy** — supertypes/subtypes (single-file)
- **Code lens** — basic code lens
- **Multi-file project navigation** — Maven/Gradle metadata parsing, workspace indexing

### Planned

- Go-to-implementation and go-to-type-definition
- Javadoc extraction and rendering in hover/completion
- Full type system — type inference, type checking, cross-dependency resolution
- Classpath resolution and dependency JAR analysis
- Source generation for method override stubs
- Advanced refactoring — extract method, inline, move, change signature
- Decompilation of library classes
- Debug adapter and test runner integration

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

Integration tests use the [Spring PetClinic](https://github.com/spring-projects/spring-petclinic) project as a realistic fixture. The pinned commit is tracked in `test-fixtures/spring-petclinic-sha.txt`.

### CI / CD

| Workflow | Trigger | Description |
|----------|---------|-------------|
| **CI** (`.github/workflows/ci.yml`) | PR / push to `main` | Lint, build, test (Node 20 & 22) with Spring PetClinic integration |
| **Update Spring PetClinic** (`.github/workflows/update-spring-petclinic.yml`) | Weekly (Monday) / manual | Checks for new PetClinic commits, runs tests, opens a PR |
| **Dependabot** (`.github/dependabot.yml`) | Weekly (Monday) | Updates npm dependencies and GitHub Action versions |

## License

[Apache-2.0](LICENSE)
