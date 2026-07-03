# MiniMax Copilot (PAYG)

A minimal VS Code extension that surfaces **MiniMax M3 / M2.7** inside **GitHub Copilot Chat** with pay‑as‑you‑go key support and collapsible reasoning.

---

## Features

- **M3 adaptive thinking** — reasoning streamed as a collapsible "Thinking" block in Copilot Chat (requires a VS Code build with the `languageModelThinkingPart` proposal active — Insiders / approved).
- **PAYG‑first** — works with a MiniMax pay‑as‑you‑go API key. No Token‑Plan subscription required.
- **Vision input** — drag, paste, or click the paperclip to attach an image. Or **type a path** like `docs/foo.png`, `C:\path\foo.png`, or `#file:foo.png` and the extension reads it for you (set `minimax.pathImageInline: false` to disable file reads).
- **China / Global endpoint switch** — pick the endpoint that matches your MiniMax account region.
- **Four model tiers** — M3 standard, M3 priority, M2.7 standard, M2.7 highspeed.
- **Secure key storage** — API key stored in VS Code SecretStorage, never written to disk or settings files.
- **Minimal** — no dashboards, no budgets, no balance monitors. Just chat, with reasoning.

---

## Prerequisites

| Requirement                   | Details                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VS Code**                   | **1.111.0** or later                                                                                                                               |
| **GitHub Copilot Chat**       | Installed and signed in                                                                                                                            |
| **MiniMax API key**           | PAYG key from [platform.minimax.io](https://platform.minimax.io) (International) or [platform.minimaxi.com](https://platform.minimaxi.com) (China) |
| **Thinking block (optional)** | VS Code Insiders or a build with the `languageModelThinkingPart` proposal enabled                                                                  |

---

## Installation

### From a `.vsix` file (manual build)

```bash
git clone https://github.com/tugudush/minimax-copilot.git
cd minimax-copilot
npm install
npm run package        # produces minimax-copilot-0.1.0.vsix
```

Then install the generated `.vsix` via the Extensions panel: `...` → **Install from VSIX...** → select the file.

> **After installing, reload VS Code** (`Ctrl+Shift+P` → **Developer: Reload Window**) to activate the extension.

---

## Setup (first use)

After installation, complete the following steps to configure the extension:

### 1. Get a MiniMax API key

Sign up at one of the following (choose the region that matches your location):

- **International:** [platform.minimax.io](https://platform.minimax.io)
- **China:** [platform.minimaxi.com](https://platform.minimaxi.com)

Create an API key from your account dashboard → **API Keys**.

### 2. Store your API key

Open the Command Palette (`Ctrl+Shift+P`) and run:

```
MiniMax: Set API Key
```

Paste your key and press Enter. The key is stored in VS Code's **SecretStorage** — it is never written to settings files or shared.

### 3. Choose your region

Run ONE of the following from the Command Palette:

| Command                          | Endpoint           |
| -------------------------------- | ------------------ |
| `MiniMax: Switch to Global API`  | `api.minimax.io`   |
| `MiniMax: Switch to Chinese API` | `api.minimaxi.com` |

> ⚠️ Using the wrong region for your key will result in **401 Unauthorized** errors.

### 4. (Optional) Toggle adaptive thinking

Thinking is **on by default** for M3 models. To turn it off:

```
MiniMax: Toggle Thinking
```

> **Note:** The collapsible "Thinking" block in Copilot Chat requires a VS Code build with the `languageModelThinkingPart` proposal active (Insiders / approved). On stable VS Code, chat works normally — the reasoning stream is included inline in the response.

---

## Usage

### Start chatting

1. Open **Copilot Chat** (`Ctrl+Shift+I`).
2. Click the model picker dropdown (top-right of the chat panel).
3. Select a MiniMax model (e.g., **MiniMax M3**).
4. Type your prompt and press Enter.

Your PAYG key is billed per token directly by MiniMax — no subscription required.

### Available models

| Model                      | ID                       | Context     | Thinking | Multimodal  | Best for                          |
| -------------------------- | ------------------------ | ----------- | -------- | ----------- | --------------------------------- |
| **MiniMax M3**             | `minimax-m3`             | 1M tokens   | ✅       | ✅ (images) | General coding, deep reasoning    |
| **MiniMax M3 Priority**    | `minimax-m3-priority`    | 1M tokens   | ✅       | ✅ (images) | Low-latency M3 (higher cost)      |
| **MiniMax M2.7**           | `minimax-m2.7`           | 200K tokens | ❌       | ❌          | Fast, cost-effective coding       |
| **MiniMax M2.7 Highspeed** | `minimax-m2.7-highspeed` | 200K tokens | ❌       | ❌          | Quick completions, lowest latency |

### PAYG pricing (USD per million tokens)

| Model            | Input                 | Output                | Cache read |
| ---------------- | --------------------- | --------------------- | ---------- |
| M3 / M3 Priority | $0.30 (priority +50%) | $1.20 (priority +50%) | $0.06      |
| M2.7             | $0.30                 | $1.20                 | $0.06      |
| M2.7 Highspeed   | $0.60                 | $2.40                 | $0.06      |

> China-region keys are billed in **¥** (CNY) at approximately the same rates.

### Switching models mid-conversation

Click the model picker in Copilot Chat at any time to switch models. Each request is independent — switching models does not lose chat context (Copilot Chat manages the message history).

---

## Settings

Configure via **File → Preferences → Settings** (`Ctrl+,`) and search for `minimax`, or edit `settings.json` directly:

| Setting                     | Type      | Default     | Description                                                                                                                                                                                        |
| --------------------------- | --------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimax.apiBaseUrl`        | `string`  | `""` (auto) | Override the Anthropic-compatible base URL. Auto-picked from your chosen region.                                                                                                                   |
| `minimax.thinking`          | `boolean` | `true`      | Enable adaptive reasoning for M3 models. Has no effect on M2.7.                                                                                                                                    |
| `minimax.visibleModels`     | `array`   | `[]` (all)  | Model IDs to show in the picker. Example: `["minimax-m3", "minimax-m2.7"]`                                                                                                                         |
| `minimax.maxOutputTokens`   | `number`  | `0`         | Output token cap per request. `0` = model decides.                                                                                                                                                 |
| `minimax.debugMode`         | `string`  | `"minimal"` | Log verbosity: `"minimal"`, `"metadata"`, or `"verbose"` (writes request bodies to disk).                                                                                                          |
| `minimax.pathImageInline`   | `boolean` | `true`      | When `true`, type an image path in chat (e.g. `docs/foo.png`) and the extension reads it and sends it to the model as a base64 image block. Set to `false` to disable file reads during inference. |
| `minimax.pathImageMaxBytes` | `integer` | `5242880`   | Per-image byte cap for path-referenced images. `0` = no cap (default 5 MB).                                                                                                                        |

---

## Commands

| Command              | Palette                          | Purpose                               |
| -------------------- | -------------------------------- | ------------------------------------- |
| **Set API Key**      | `MiniMax: Set API Key`           | Store your PAYG key in SecretStorage. |
| **Clear API Key**    | `MiniMax: Clear API Key`         | Remove the stored key.                |
| **Switch to Global** | `MiniMax: Switch to Global API`  | Use `api.minimax.io` endpoint.        |
| **Switch to China**  | `MiniMax: Switch to Chinese API` | Use `api.minimaxi.com` endpoint.      |
| **Toggle Thinking**  | `MiniMax: Toggle Thinking`       | Enable/disable M3 adaptive reasoning. |
| **Show Logs**        | `MiniMax: Show Logs`             | Open the extension output channel.    |

---

## Troubleshooting

### "401 Unauthorized" or "Invalid API key"

- Verify your key is correct: run **MiniMax: Set API Key** again.
- Make sure the region matches your account: Global keys → **Switch to Global API**, China keys → **Switch to Chinese API**.
- Check that your MiniMax account has sufficient balance at the [billing page](https://platform.minimax.io/user-center/basic-information/account-manage).

### Models don't appear in the picker

- Ensure **GitHub Copilot Chat** is installed and you are signed in.
- Check `minimax.visibleModels` — if set, only listed models appear. Clear it to show all.
- Run **MiniMax: Show Logs** and check for error messages (set `minimax.debugMode` to `"verbose"` for full details).

### Thinking block not rendering

- The collapsible "Thinking" block requires a VS Code build where the `languageModelThinkingPart` proposal is active. This is available in **VS Code Insiders** or approved stable builds.
- On standard stable VS Code, reasoning content is still delivered — it appears inline in the response text.
- Ensure `minimax.thinking` is `true` and you are using an M3 model (M2.7 does not support thinking).

### High latency or slow responses

- M3 models may take longer due to adaptive reasoning. Switch to **MiniMax M2.7 Highspeed** for lower latency.
- If using the China endpoint from outside China, expect higher network latency.

---

## Building from source

```bash
npm install          # install dependencies
npm run compile      # esbuild → dist/extension.js
npm test             # run test suite
npm run package      # vsce package → .vsix
npm run ltfb         # lint + typecheck + format + compile (full check)
```

### Updating an existing install

After pulling new source, the easiest way to pick up changes is:

```bash
npm run package
```

Then in VS Code: **Extensions** panel → ⋯ → **Install from VSIX...** →
pick `minimax-copilot-0.1.0.vsix`, and **Developer: Reload Window**.
This atomic replace avoids the "VS Code holds the old JS file open"
snag that a manual `cp dist/extension.js` into the extensions folder
can hit.

---

## Attribution

Inspired by [`klarkxy/minimax-vscode`](https://github.com/klarkxy/minimax-vscode) (MiniMax Copilot) by **Klarkxy** — please star the original project. This extension is a fresh, focused implementation; no source code is copied.

## License

MIT. "MiniMax" is a trademark of MiniMax; this extension is not endorsed by MiniMax.
