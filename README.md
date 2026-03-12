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

### Current (Phase 1-2)

- As-you-type syntax error reporting for Java files
- Pure JavaScript — no JVM, no Java installation needed

### Planned

- Document symbols (outline)
- Code folding
- Code formatting (via Prettier Java)
- Hover information
- Code completion
- Go-to-definition
- Find references
- Rename
- Semantic highlighting
- Multi-file project navigation
- Maven/Gradle project support
- Full type system & code intelligence

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

## License

[Apache-2.0](LICENSE)
