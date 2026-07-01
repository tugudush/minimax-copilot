# MiniMax Copilot (PAYG)

A minimal VS Code extension that surfaces **MiniMax M3 / M2.7** inside **GitHub Copilot Chat** with pay‑as‑you‑go key support and collapsible reasoning.

### Features

- **M3 adaptive thinking** — reasoning streamed as a collapsible "Thinking" block in Copilot Chat (requires a VS Code build with the `languageModelThinkingPart` proposal active — Insiders / approved).
- **PAYG‑first** — works with a MiniMax pay‑as‑you‑go API key. No Token‑Plan subscription required.
- **China / Global endpoint switch** — pick the endpoint that matches your MiniMax account.
- **Minimal** — no dashboards, no budgets, no balance monitors. Just chat, with reasoning.

### Quick start

1. Install from the VS Code Marketplace, or build from source: `npm run package` → install the `.vsix`.
2. Run **MiniMax: Set API Key** and paste your MiniMax API key.
3. Run **MiniMax: Switch to Global API** or **MiniMax: Switch to Chinese API** to match your key's region.
4. Open Copilot Chat (`Ctrl+Shift+I`), pick **MiniMax M3** from the model picker, and start chatting.

### Requirements

- VS Code **1.111.0** or later.
- GitHub Copilot Chat extension installed and signed in.
- A MiniMax API key ([platform.minimax.io](https://platform.minimax.io) — International, or [platform.minimaxi.com](https://platform.minimaxi.com) — China).
- For the **collapsible reasoning block**, a VS Code build where the `languageModelThinkingPart` proposal is active. On stable VS Code, chat still works — reasoning just won't render as a separate block.

### Settings

| Setting                   | Default   | Purpose                                        |
| ------------------------- | --------- | ---------------------------------------------- |
| `minimax.apiBaseUrl`      | auto      | Anthropic base URL; auto‑picked from locale.   |
| `minimax.thinking`        | `true`    | M3 adaptive reasoning on/off.                  |
| `minimax.visibleModels`   | all       | Restrict picker entries.                       |
| `minimax.maxOutputTokens` | `0`       | Output cap (`0` = model decides).              |
| `minimax.debugMode`       | `minimal` | Verbosity: `minimal` / `metadata` / `verbose`. |

### Commands

| Command                          | Purpose                                  |
| -------------------------------- | ---------------------------------------- |
| `MiniMax: Set API Key`           | Store your key in VS Code SecretStorage. |
| `MiniMax: Clear API Key`         | Remove the stored key.                   |
| `MiniMax: Switch to Global API`  | Endpoint → `api.minimax.io`.             |
| `MiniMax: Switch to Chinese API` | Endpoint → `api.minimaxi.com`.           |
| `MiniMax: Toggle Thinking`       | Turn M3 reasoning on or off.             |
| `MiniMax: Show Logs`             | Focus the output channel.                |

### Building from source

```bash
npm install
npm run compile   # esbuild → dist/extension.js
npm test          # node --test (10 tests)
npm run package   # vsce package → .vsix
```

## Attribution

Inspired by [`klarkxy/minimax-vscode`](https://github.com/klarkxy/minimax-vscode) (MiniMax Copilot) by **Klarkxy** — please star the original project. This extension is a fresh, focused implementation; no source code is copied.

## License

MIT. "MiniMax" is a trademark of MiniMax; this extension is not endorsed by MiniMax.
