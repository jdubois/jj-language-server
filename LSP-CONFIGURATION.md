# LSP Configuration Guide

This guide explains how to configure **jj-language-server** as your Java language server.

## Prerequisites

Install jj-language-server globally:

```bash
npm install -g jj-language-server
```

Verify the installation:

```bash
jj-language-server --version
```

The server communicates over **stdio** using the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).

---

## GitHub Copilot CLI

[GitHub Copilot CLI](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line) can leverage language servers for enhanced code understanding.

### Setup

1. Ensure GitHub Copilot CLI is installed:

```bash
gh extension install github/gh-copilot
```

2. Install jj-language-server:

```bash
npm install -g jj-language-server
```

3. The GitHub Copilot CLI will automatically discover language servers configured in your editor. If you use VS Code with jj-language-server configured (see below), Copilot CLI will benefit from it when working within a VS Code terminal.

### What It Provides

When using GitHub Copilot CLI in a Java project directory, the server provides:

- **Completions and suggestions** — informed by your project's Java symbols
- **Code navigation context** — understanding of class hierarchies, imports, and references
- **Diagnostics** — real-time error detection without waiting for a JVM to start

---

## Visual Studio Code

VS Code uses JDTLS by default for Java (via the "Language Support for Java" extension). To use jj-language-server instead:

### Step 1: Disable JDTLS

If you have the "Language Support for Java(TM) by Red Hat" extension installed, disable it to avoid conflicts:

1. Open Extensions sidebar (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Search for "Language Support for Java"
3. Click the gear icon → **Disable** (choose "Disable (Workspace)" to only affect the current project)

### Step 2: Install the Generic LSP Client Extension

VS Code does **not** include a built-in generic LSP client — you need an extension. Install [Generic LSP Client (v2)](https://marketplace.visualstudio.com/items?itemName=zsol.vscode-glspc) from the Marketplace.

### Step 3: Configure jj-language-server

Open your VS Code settings (`Ctrl+Shift+P` / `Cmd+Shift+P` → "Preferences: Open User Settings (JSON)") and add:

```json
{
  "glspc.server.command": "jj-language-server",
  "glspc.server.commandArguments": ["--stdio"],
  "glspc.server.languageId": ["java"]
}
```

> **Troubleshooting:** Check the output panel (`View` → `Output`) and select "Generic LSP Client" from the dropdown to see server logs. If you get `ENOENT`, use the full path from `which jj-language-server`.

---

## Configuration Options

### Command-Line Flags

| Flag | Description |
|---|---|
| `--stdio` | **(Required)** Use stdio for communication |
| `--log-level <n>` | Log verbosity: `4` = log, `3` = info (default), `2` = warn, `1` = error |
| `--version` | Print version and exit |

### Example with Debug Logging

```bash
jj-language-server --stdio --log-level 4
```

---

## Platform-Specific Notes

### Windows

- Use `jj-language-server.cmd` if the npm global bin directory is in your PATH:
  ```
  %APPDATA%\npm\jj-language-server.cmd --stdio
  ```
- Or use the full path to Node.js:
  ```
  node C:\Users\<user>\AppData\Roaming\npm\node_modules\jj-language-server\lib\cli.mjs --stdio
  ```

### macOS

- If installed via npm, the binary is typically at:
  ```
  /usr/local/bin/jj-language-server
  ```
  or with Homebrew Node.js:
  ```
  /opt/homebrew/bin/jj-language-server
  ```

### Linux

- The binary is typically at:
  ```
  /usr/local/bin/jj-language-server
  ```
- For NVM users, ensure the correct Node.js version is active:
  ```bash
  nvm use 22
  jj-language-server --stdio
  ```

---

## Troubleshooting

### Server Not Starting

1. Verify the installation: `jj-language-server --version`
2. Check that Node.js ≥ 22 is installed: `node --version`
3. Test the server responds to LSP initialization:
   ```bash
   { printf 'Content-Length: 107\r\n\r\n{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":null,"capabilities":{}}}'; sleep 2; } | jj-language-server --stdio
   ```
   You should see a JSON response containing `"capabilities"`. If you get no output, check your Node.js version and PATH.

### No Completions or Diagnostics

1. Ensure the editor has opened a `.java` file
2. Check that the project root contains `pom.xml` or `build.gradle`
3. For Maven projects, run `mvn dependency:resolve` once to populate the local cache
4. For Gradle projects, run `gradle build` once to populate the local cache

### Conflicts with JDTLS

If you have both JDTLS and jj-language-server configured, disable one to avoid conflicts. In VS Code, disable the "Language Support for Java" extension when using jj-language-server.
