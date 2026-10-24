# MiniMax Copilot (PAYG)

A minimal VS Code extension that surfaces **MiniMax M3.1 Flash / M3** inside **GitHub Copilot Chat** with pay‑as‑you‑go key support and collapsible reasoning.

---

## Features

- **M3.1 Flash** — the latest MiniMax M-series model: 1M context, multimodal input, always-on reasoning with tunable depth, and the lowest PAYG price ($0.15 / $0.60 per M tokens).
- **M3 adaptive thinking** — reasoning streamed as a collapsible "Thinking" block in Copilot Chat (requires the `languageModelThinkingPart` proposed API — see [Thinking block not rendering](#thinking-block-not-rendering)).
- **PAYG‑first** — works with a MiniMax pay‑as‑you‑go API key. No Token‑Plan subscription required.
- **China / Global endpoint switch** — pick the endpoint that matches your MiniMax account region.
- **Three model tiers** — M3.1 Flash, M3 standard, M3 priority.
- **Secure key storage** — API key stored in VS Code SecretStorage, never written to disk or settings files.
- **Minimal** — no dashboards, no budgets, no balance monitors. Just chat, with reasoning.

---

## Prerequisites

| Requirement                   | Details                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VS Code**                   | **1.111.0** or later                                                                                                                               |
| **GitHub Copilot Chat**       | Installed and signed in                                                                                                                            |
| **MiniMax API key**           | PAYG key from [platform.minimax.io](https://platform.minimax.io) (International) or [platform.minimaxi.com](https://platform.minimaxi.com) (China) |
| **Thinking block (optional)** | A build where the `languageModelThinkingPart` proposal is enabled — see [Thinking block not rendering](#thinking-block-not-rendering)              |

---

## Installation

### From a `.vsix` file (manual build)

```bash
git clone https://github.com/tugudush/minimax-copilot.git
cd minimax-copilot
npm install
npm run package        # produces minimax-copilot-0.2.0.vsix
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

> **Note:** The collapsible "Thinking" block in Copilot Chat requires the `languageModelThinkingPart` proposed API to be active. On builds where it is not, chat works normally — the reasoning stream is included inline in the response. See [Thinking block not rendering](#thinking-block-not-rendering) for how to enable it.

### 5. (Optional) Set the thinking depth for M3.1 Flash

**MiniMax M3.1 Flash always reasons** — the API rejects `thinking: disabled`. Tune how deeply it thinks instead:

```
MiniMax: Set Thinking Effort
```

Pick `low`, `medium`, `high`, `xhigh`, or `max` (the default). Higher levels reason more thoroughly, at the cost of latency and tokens.

---

## Usage

### Start chatting

1. Open **Copilot Chat** (`Ctrl+Shift+I`).
2. Click the model picker dropdown (top-right of the chat panel).
3. Select a MiniMax model (e.g., **MiniMax M3**).
4. Type your prompt and press Enter.

Your PAYG key is billed per token directly by MiniMax — no subscription required.

### Available models

| Model                   | ID                    | Context   | Thinking        | Multimodal  | Best for                          |
| ----------------------- | --------------------- | --------- | --------------- | ----------- | --------------------------------- |
| **MiniMax M3.1 Flash**  | `MiniMax-M3.1-Flash`  | 1M tokens | ✅ always-on    | ✅ (images) | Fastest, cheapest, agentic coding |
| **MiniMax M3**          | `minimax-m3`          | 1M tokens | ✅ (toggleable) | ✅ (images) | General coding, deep reasoning    |
| **MiniMax M3 Priority** | `minimax-m3-priority` | 1M tokens | ✅ (toggleable) | ✅ (images) | Low-latency M3 (higher cost)      |

> **M3.1 Flash thinking.** This model always reasons — the API rejects
> `thinking: disabled` with a `400`. Tune the depth instead with
> **MiniMax: Set Thinking Effort** (`low` → `max`). The
> **MiniMax: Toggle Thinking** command does not affect it.

> **M2.x models were removed.** MiniMax retired the M2.5 / M2.7
> families on 2026-11-18, and the Anthropic-compatible endpoint now
> serves only M3.1 Flash and M3.

### PAYG pricing (USD per million tokens)

| Model            | Input                 | Output                | Cache read |
| ---------------- | --------------------- | --------------------- | ---------- |
| M3.1 Flash       | $0.15                 | $0.60                 | $0.015     |
| M3 / M3 Priority | $0.30 (priority +50%) | $1.20 (priority +50%) | $0.06      |

> China-region keys are billed in **¥** (CNY) at approximately the same rates.

### Switching models mid-conversation

Click the model picker in Copilot Chat at any time to switch models. Each request is independent — switching models does not lose chat context (Copilot Chat manages the message history).

---

## Settings

Configure via **File → Preferences → Settings** (`Ctrl+,`) and search for `minimax`, or edit `settings.json` directly:

| Setting                   | Type      | Default     | Description                                                                               |
| ------------------------- | --------- | ----------- | ----------------------------------------------------------------------------------------- |
| `minimax.apiBaseUrl`      | `string`  | `""` (auto) | Override the Anthropic-compatible base URL. Auto-picked from your chosen region.          |
| `minimax.thinking`        | `boolean` | `true`      | Enable adaptive reasoning for M3 models. Has no effect on M3.1 Flash (always on).         |
| `minimax.thinkingEffort`  | `string`  | `"max"`     | Thinking depth for M3.1 Flash: `low`, `medium`, `high`, `xhigh`, or `max`.                |
| `minimax.visibleModels`   | `array`   | `[]` (all)  | Model IDs to show in the picker. Example: `["MiniMax-M3.1-Flash", "minimax-m3"]`          |
| `minimax.maxOutputTokens` | `number`  | `0`         | Output token cap per request. `0` = model decides.                                        |
| `minimax.debugMode`       | `string`  | `"minimal"` | Log verbosity: `"minimal"`, `"metadata"`, or `"verbose"` (writes request bodies to disk). |

---

## Commands

| Command                 | Palette                          | Purpose                               |
| ----------------------- | -------------------------------- | ------------------------------------- |
| **Set API Key**         | `MiniMax: Set API Key`           | Store your PAYG key in SecretStorage. |
| **Clear API Key**       | `MiniMax: Clear API Key`         | Remove the stored key.                |
| **Switch to Global**    | `MiniMax: Switch to Global API`  | Use `api.minimax.io` endpoint.        |
| **Switch to China**     | `MiniMax: Switch to Chinese API` | Use `api.minimaxi.com` endpoint.      |
| **Toggle Thinking**     | `MiniMax: Toggle Thinking`       | Enable/disable M3 adaptive reasoning. |
| **Set Thinking Effort** | `MiniMax: Set Thinking Effort`   | Pick the M3.1 Flash reasoning depth.  |
| **Show Logs**           | `MiniMax: Show Logs`             | Open the extension output channel.    |

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

The collapsible "Thinking" block needs the `languageModelThinkingPart` proposed API. VS Code **strips the proposal from installed extensions** unless the extension is on VS Code's built-in allowlist — this extension is not, so the block is silently dropped and reasoning arrives as inline text instead.

Check the log: **Help → Toggle Developer Tools → Console**, or `Help → Show Logs…`. You will see:

```
Extension 'minimax-copilot-paygo.minimax-copilot' CANNOT USE these API proposals
'languageModelThinkingPart'. You MUST start in extension development mode or use the
--enable-proposed-api command line flag
```

**To enable it for a local install**, add the extension to `argv.json`:

1. Run **Preferences: Configure Runtime Arguments** (from the Command Palette).
2. Add the extension ID to the `enable-proposed-api` array:

   ```json
   "enable-proposed-api": ["minimax-copilot-paygo.minimax-copilot"]
   ```

3. Fully quit VS Code and relaunch — `argv.json` is read only at startup.

Alternatively, launch VS Code with the flag:

```bash
code --enable-proposed-api=minimax-copilot-paygo.minimax-copilot
```

Without the proposal, everything else still works: chat, tool calling, images, and the M3.1 Flash / M3 / M3 Priority models. Only the collapsible rendering is lost.

> **Note:** the proposed API is unstable and may change between VS Code releases, and it is not covered by VS Code's API stability guarantees.

### High latency or slow responses

- M3 models may take longer due to adaptive reasoning. For M3.1 Flash, lower the reasoning depth with **MiniMax: Set Thinking Effort** — `low` or `medium` is noticeably faster than `max`.
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

---

## Attribution

Inspired by [`klarkxy/minimax-vscode`](https://github.com/klarkxy/minimax-vscode) (MiniMax Copilot) by **Klarkxy** — please star the original project. This extension is a fresh, focused implementation; no source code is copied.

## License

MIT. "MiniMax" is a trademark of MiniMax; this extension is not endorsed by MiniMax.
