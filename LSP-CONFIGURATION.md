# LSP Configuration Guide

This guide explains how to configure **jj-language-server** as your Java language server in various editors and tools.

## Prerequisites

Install jj-language-server globally:

```bash
npm install -g @jdubois/jj-language-server
```

Verify the installation:

```bash
jj-language-server --version
```

The server communicates over **stdio** using the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).

---

## Visual Studio Code

VS Code uses JDTLS by default for Java (via the "Language Support for Java" extension). To use jj-language-server instead, you have two options:

### Option A: Using the Generic LSP Client Extension

1. Install the [vscode-lsp-client](https://marketplace.visualstudio.com/items?itemName=nicolo-ribaudo.vscode-lsp-client) extension (or any generic LSP client extension).

2. Open your VS Code settings (`settings.json`):
   - **Windows/Linux:** `Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)"
   - **macOS:** `Cmd+Shift+P` → "Preferences: Open User Settings (JSON)"

3. Add the following configuration:

```json
{
  "lspClient.serverCommands": {
    "java": {
      "command": "jj-language-server",
      "args": ["--stdio"]
    }
  }
}
```

### Option B: Using a Custom tasks.json + Launch Configuration

1. Create `.vscode/settings.json` in your workspace:

```json
{
  "java.server.launchMode": "Disabled"
}
```

This disables the built-in JDTLS. Then configure jj-language-server via a generic LSP extension as described in Option A.

### Disabling JDTLS

If you have the "Language Support for Java(TM) by Red Hat" extension installed and want to use jj-language-server exclusively:

1. Open Extensions sidebar (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Search for "Language Support for Java"
3. Click **Disable** (you can choose to disable it per workspace)

---

## Neovim

### Using nvim-lspconfig

Add to your Neovim configuration (e.g., `~/.config/nvim/init.lua`):

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

-- Register jj-language-server as a custom LSP
if not configs.jj_ls then
  configs.jj_ls = {
    default_config = {
      cmd = { 'jj-language-server', '--stdio' },
      filetypes = { 'java' },
      root_dir = lspconfig.util.root_pattern('pom.xml', 'build.gradle', 'build.gradle.kts', '.git'),
      settings = {},
    },
  }
end

lspconfig.jj_ls.setup {}
```

### Using Mason (optional)

If you use [mason.nvim](https://github.com/williamboman/mason.nvim), you can install jj-language-server via npm and configure it manually as shown above.

---

## Sublime Text

### Using LSP Package

1. Install [LSP](https://packagecontrol.io/packages/LSP) via Package Control.

2. Open **Preferences → Package Settings → LSP → Settings** and add:

```json
{
  "clients": {
    "jj-language-server": {
      "enabled": true,
      "command": ["jj-language-server", "--stdio"],
      "selector": "source.java",
      "schemes": ["file"]
    }
  }
}
```

---

## Emacs

### Using lsp-mode

Add to your Emacs configuration:

```elisp
(require 'lsp-mode)

(lsp-register-client
 (make-lsp-client
  :new-connection (lsp-stdio-connection '("jj-language-server" "--stdio"))
  :activation-fn (lsp-activate-on "java")
  :server-id 'jj-ls))

(add-hook 'java-mode-hook #'lsp)
```

### Using eglot (built-in since Emacs 29)

```elisp
(add-to-list 'eglot-server-programs
             '(java-mode . ("jj-language-server" "--stdio")))

(add-hook 'java-mode-hook 'eglot-ensure)
```

---

## Helix

Add to `~/.config/helix/languages.toml`:

```toml
[[language]]
name = "java"
language-servers = ["jj-language-server"]

[language-server.jj-language-server]
command = "jj-language-server"
args = ["--stdio"]
```

---

## GitHub Copilot CLI

GitHub Copilot CLI can leverage language servers for enhanced code understanding. To configure jj-language-server:

### Setup

1. Ensure [GitHub Copilot CLI](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line) is installed:

```bash
gh extension install github/gh-copilot
```

2. Install jj-language-server:

```bash
npm install -g @jdubois/jj-language-server
```

3. The GitHub Copilot CLI will automatically discover language servers configured in your editor. If you use VS Code with jj-language-server configured (see above), Copilot CLI will benefit from it when working within a VS Code terminal.

### Direct Usage

When using GitHub Copilot CLI in a Java project directory, the server provides:

- **Completions and suggestions** — informed by your project's Java symbols
- **Code navigation context** — understanding of class hierarchies, imports, and references
- **Diagnostics** — real-time error detection without waiting for a JVM to start

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
  node C:\Users\<user>\AppData\Roaming\npm\node_modules\@jdubois\jj-language-server\lib\cli.mjs --stdio
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
3. Try running manually: `jj-language-server --stdio --log-level 4`

### No Completions or Diagnostics

1. Ensure the editor has opened a `.java` file
2. Check that the project root contains `pom.xml` or `build.gradle`
3. For Maven projects, run `mvn dependency:resolve` once to populate the local cache
4. For Gradle projects, run `gradle build` once to populate the local cache

### Conflicts with JDTLS

If you have both JDTLS and jj-language-server configured, disable one to avoid conflicts. In VS Code, disable the "Language Support for Java" extension when using jj-language-server.
