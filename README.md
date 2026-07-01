# MiniMax Copilot (PAYG) · MiniMax 按量付费 Copilot

[English](#english) | [中文](#中文)

---

## English

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

---

## 中文

一个极简的 VS Code 扩展，将 **MiniMax M3 / M2.7** 模型集成到 **GitHub Copilot Chat** 中，
支持按量付费密钥和可折叠思维链。

### 功能

- **M3 自适应思维链** — 推理过程以可折叠的"Thinking"块形式在 Copilot Chat 中显示（需要 VS Code 版本启用 `languageModelThinkingPart` 提案 — Insiders 或已批准版本）。
- **按量付费优先** — 使用 MiniMax 按量付费 API 密钥即可，无需 Token 套餐订阅。
- **中国站/国际站切换** — 选择与您的 MiniMax 账户匹配的端点。
- **极简设计** — 无仪表盘、无预算、无余额监控。只有聊天和推理。

### 快速开始

1. 从 VS Code 市场安装，或从源码构建：`npm run package` → 安装 `.vsix`。
2. 运行 **MiniMax: 设置 API 密钥** 并粘贴您的 MiniMax API 密钥。
3. 运行 **MiniMax: 切换到国际站** 或 **MiniMax: 切换到中国站** 以匹配您的密钥区域。
4. 打开 Copilot Chat (`Ctrl+Shift+I`)，从模型选择器中选择 **MiniMax M3**，开始对话。

### 系统要求

- VS Code **1.111.0** 或更高版本。
- 已安装并登录 GitHub Copilot Chat 扩展。
- MiniMax API 密钥（[platform.minimax.io](https://platform.minimax.io) — 国际站，或 [platform.minimaxi.com](https://platform.minimaxi.com) — 中国站）。
- 可折叠思维链需要启用 `languageModelThinkingPart` 提案的 VS Code 版本。在稳定版 VS Code 中，聊天仍然可用 — 只是推理不会显示为单独的块。

### 设置

| 设置                      | 默认值    | 用途                                           |
| ------------------------- | --------- | ---------------------------------------------- |
| `minimax.apiBaseUrl`      | auto      | Anthropic 兼容端点；根据语言环境自动选择。     |
| `minimax.thinking`        | `true`    | M3 自适应推理开关。                            |
| `minimax.visibleModels`   | all       | 限制模型选择器中的条目。                       |
| `minimax.maxOutputTokens` | `0`       | 输出上限（`0` = 模型决定）。                   |
| `minimax.debugMode`       | `minimal` | 调试级别：`minimal` / `metadata` / `verbose`。 |

### 命令

| 命令                     | 用途                                  |
| ------------------------ | ------------------------------------- |
| `MiniMax: 设置 API 密钥` | 在 VS Code SecretStorage 中存储密钥。 |
| `MiniMax: 清除 API 密钥` | 移除已存储的密钥。                    |
| `MiniMax: 切换到国际站`  | 端点 → `api.minimax.io`。             |
| `MiniMax: 切换到中国站`  | 端点 → `api.minimaxi.com`。           |
| `MiniMax: 切换思维链`    | 开启或关闭 M3 推理。                  |
| `MiniMax: 显示日志`      | 打开输出通道。                        |

### 从源码构建

```bash
npm install
npm run compile   # esbuild → dist/extension.js
npm test          # node --test (10 个测试)
npm run package   # vsce package → .vsix
```

---

## Attribution / 致谢

Inspired by [`klarkxy/minimax-vscode`](https://github.com/klarkxy/minimax-vscode) (MiniMax Copilot) by **Klarkxy** — please star the original project. This extension is a fresh, focused implementation; no source code is copied.

受 [Klarkxy](https://github.com/klarkxy/minimax-vscode) 的 MiniMax Copilot 启发 — 请给原项目加星。本扩展是全新的聚焦实现，未复制任何源代码。

## License / 许可证

MIT. "MiniMax" is a trademark of MiniMax; this extension is not endorsed by MiniMax.

MIT 许可证。"MiniMax" 是 MiniMax 的商标；本扩展未获得 MiniMax 背书。
