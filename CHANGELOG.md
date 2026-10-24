# Changelog

All notable changes to **MiniMax Copilot (PAYG)** are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] — 2026-10-24

### Added

- **MiniMax M3.1 Flash** (`MiniMax-M3.1-Flash`) — the latest
  MiniMax M-series model, now first in the Copilot Chat model
  picker. 1M-token context window, multimodal (image/video) input,
  and the lowest PAYG rate of any model in the extension
  ($0.15 input / $0.60 output per M tokens, $0.015 cache read).
- **Tunable thinking depth** — new `minimax.thinkingEffort` setting
  (`low` | `medium` | `high` | `xhigh` | `max`, default `max`) and a
  **MiniMax: Set Thinking Effort** command. Sent upstream as
  `output_config.effort`, which is supported by M3.1 Flash only.
- **Per-model output caps** — `max_tokens` now defaults to each
  model's own cap instead of a flat 4096 (M3.1 Flash: 32,768;
  M3: 8,192). `minimax.maxOutputTokens` still overrides.

### Removed

- **MiniMax M2.7 and M2.7 Highspeed** — the M2.x models are no
  longer offered in the picker. MiniMax retired the M2.5 / M2.7
  families on 2026-11-18, and the Anthropic-compatible endpoint now
  serves only M3.1 Flash and M3. Their model IDs, context limits,
  output caps, pricing entries, and localized display names were
  removed along with them.

### Changed

- **M3.1 Flash always thinks.** The API rejects
  `thinking: {type: "disabled"}` for this model with a `400`, so the
  `minimax.thinking` toggle does not apply to it — the request always
  carries `thinking: {type: "adaptive"}`. Use the thinking-effort
  setting to control depth instead.
- **Model display names are resolved lazily.** They were previously
  frozen at module-load time, before `initI18n()` ran, so the picker
  always showed the English name regardless of locale.
- **Picker metadata comes from the registry.** `family` and
  `maxOutputTokens` are now read from the model table instead of
  being derived from the model ID string.
- **Thinking is gated on registry metadata.** The request builder
  now consults the model's `thinking` flag instead of matching
  `m3` against the model ID string.
- **README and walkthroughs now describe how to enable the proposed
  API for a local install.** The previous wording implied the
  collapsible Thinking block worked on Insiders out of the box. In
  fact VS Code strips `languageModelThinkingPart` from _all_ installed
  extensions that are not on its built-in allowlist — including this
  one — so the block is dropped unless the user adds the extension to
  `argv.json` under `enable-proposed-api`.

### Known limitations

- **Marketplace publishing is blocked** by the `languageModelThinkingPart`
  proposed API. `vsce publish` fails with "Extensions using unallowed
  proposed API". Passing `--allow-proposed-apis` bypasses the client-side
  check, but VS Code then strips the proposal at runtime, so the
  collapsible Thinking block would not render for Marketplace users.
  See `docs/publishing.md` for the two viable paths (publish without the
  proposal, or obtain approval from the VS Code team).

---

## [0.1.0] — 2026-07-02

Initial release. PAYG-first VS Code extension that surfaces **MiniMax
M3 / M3 Priority / M2.7 / M2.7 Highspeed** inside **GitHub Copilot
Chat**, with adaptive thinking rendered as a collapsible block.

### Fixed — `loop-repeat` (Copilot trapped in `git status` etc.)

Four stacked bugs in `src/client/convert.ts` and the supporting streaming
plumbing caused the model to re-propose a tool it had already received an
answer for. Each fix is independently valuable; the last one actually
stopped the loop. See [`docs/bugs/loop-repeat/findings-and-plan.md`](docs/bugs/loop-repeat/findings-and-plan.md)
for the full postmortem.

- **`isToolResultPart` / `extractToolResultText` — wrapper unwrap.** A
  `LanguageModelToolResultPart` whose `content` is a wrapped
  `LanguageModelToolResult` (not a raw array) was dropped entirely,
  leaving the `tool_use` orphaned in the Anthropic payload.
- **Non-text part types (`PromptTsxPart`, `DataPart`)** previously
  collapsed to `''` because `getPartValue` only read `.value` as a
  string. The new `extractPartText` handles `TextPart`, `DataPart`
  (UTF-8 decode for text-ish mime, `[binary <mime>]` otherwise), and
  serialises anything else via `safeStringify` so it is never silently
  dropped.
- **`cache_control` synthetic marker** — Copilot Chat appends a
  `{ mimeType: 'cache_control', data: 'ephemeral' }` data part as a
  prompt-cache breakpoint hint. It is **not** real tool output.
  `extractPartText` now drops it silently instead of serialising it as
  literal `[binary cache_control]` text.
- **Role mapping (`ROLE_SYSTEM=0, ROLE_USER=1, ROLE_ASSISTANT=2`).** The
  old converter used an outdated mapping (`User=2, Assistant=3`) that
  swapped real user and assistant turns in the Anthropic payload, so
  `tool_use` history was attributed to the wrong speaker. The model
  re-proposed the same tool because the previous `tool_use`/`tool_result`
  exchange was structurally invalid. This is the **loop's real root
  cause**.

### Added

- **Chat provider** (`src/provider/`) — implements
  `vscode.LanguageModelChatProvider`. Lists four models in the
  Copilot Chat picker and streams responses.
- **PAYG auth** (`src/auth.ts`) — single API key in
  `context.secrets` under `minimax-paygo.apiKey`. Never written to
  settings or `globalState`. `onDidChangeApiKey` event for multi-window
  picker refresh.
- **Anthropic-compatible streaming client** (`src/client/client.ts`) —
  wraps `@anthropic-ai/sdk@^0.39.0`; maps SSE events
  (`text_delta`, `thinking_delta`, `input_json_delta`,
  `content_block_stop`, `message_delta`) to VS Code language-model
  parts (`LanguageModelTextPart`, `LanguageModelThinkingPart`,
  `LanguageModelToolCallPart`).
- **VS Code → Anthropic converter** (`src/client/convert.ts`) —
  system extraction, text/thinking/tool-call/tool-result mapping,
  thinking-block replay with `signature`, alternate-role merge.
- **Adaptive thinking** (M3 family) — sends
  `thinking: { type: "adaptive" }` when `minimax.thinking` is on (default
  `true`). When off, the field is **omitted** (not sent as
  `disabled` — see `docs/plan.md` §4.5 note). M2.7 never sends it.
- **Collapsible Thinking block** — uses proposed API
  `languageModelThinkingPart` (`enabledApiProposals` in
  `package.json`); runtime guard in
  `src/runtime/thinkingPartGuard.ts` silently drops thinking deltas
  on stable VS Code where the proposal is not active.
- **Tool calling** — passes through Copilot Chat's tool set; emits
  `LanguageModelToolCallPart` on block completion; force
  `tool_choice: "any"` only when `toolMode === 2` (Required).
- **Region switching** (`src/runtime/endpoint.ts`) — auto-picks
  `api.minimax.io` (Global) for non-`zh` locales,
  `api.minimaxi.com` (China) for `zh*`; explicit `MiniMax: Switch to
Global API` / `MiniMax: Switch to Chinese API` commands override
  the default and persist to `minimax.apiBaseUrl`.
- **Error toasts** (`src/client/error.ts`) — 401/403 (invalid key),
  402 (insufficient credits, with a **Top Up** button that opens the
  region-appropriate billing page), 429 (rate-limited), 5xx (server),
  network errors.
- **Bilingual UI strings** (`src/i18n.ts`) — `en` + `zh`, resolved once
  at activation from `vscode.env.language`. Used in commands, toasts,
  walkthroughs, and model-picker tooltips.
- **Output-channel logger** (`src/logger.ts`) — `apiKey` redaction;
  `minimax.debugMode: minimal | metadata | verbose`. Verbose mode
  writes full request bodies to `os.tmpdir() / minimax-request-*.json`.
- **Walkthrough** (`walkthroughs/setup/*.md`) — four steps
  (Welcome, Set API Key, Choose Region, Adaptive Thinking) opened
  automatically on first install.
- **Commands (6)** — `MiniMax: Set API Key`, `MiniMax: Clear API Key`,
  `MiniMax: Switch to Global API`, `MiniMax: Switch to Chinese API`,
  `MiniMax: Toggle Thinking`, `MiniMax: Show Logs`.
- **Settings (5)** — `minimax.apiBaseUrl`, `minimax.thinking`,
  `minimax.visibleModels`, `minimax.maxOutputTokens`,
  `minimax.debugMode`.
- **Models (4)** — `minimax-m3` (1M ctx, thinking, multimodal),
  `minimax-m3-priority` (1M ctx, +50% pricing), `minimax-m2.7`
  (200K ctx, no thinking), `minimax-m2.7-highspeed` (200K ctx, +2×
  pricing).
- **Build tooling** — esbuild → `dist/extension.js`; ESLint
  flat config; Prettier; `tsc --noEmit`; `npm run ltfb` =
  lint + typecheck + format + compile.

### Tests

- 15/15 passing in `test/convert.test.ts`:
  - 10 covering system extraction, text/thinking/tool-call/tool-result
    conversion, and thinking-block round-trip with signatures.
  - 5 new covering the loop-repeat fixes: wrapped
    `LanguageModelToolResult` tool results, `LanguageModelDataPart`
    tool results, the synthetic `cache_control` `DataPart` drop,
    `LanguageModelPromptTsxPart` tool results, and role-mapping
    regression coverage via explicit `ROLE_*` constants in fixtures.

### Known limitations

- The collapsible Thinking block requires a VS Code build with
  `languageModelThinkingPart` active (Insiders, or an approved
  signed build). On stable VS Code, thinking is dropped silently —
  chat still works, reasoning just isn't surfaced as a separate block.
- `MiniMax: Test Key` described in `docs/plan.md` is **not** shipped
  in `0.1.0` (deferred). Use the existing key + region commands and
  the output channel to verify a key manually.
- `docs/plan.md` mentions a Chinese README; `0.1.0` ships
  English-only. Bilingual UI strings exist in `src/i18n.ts` and can
  be exported to a docs build later.

[0.2.0]: #020--2026-10-24
[0.1.0]: #010--2026-07-02
