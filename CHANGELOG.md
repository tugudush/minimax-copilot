# Changelog

All notable changes to **MiniMax Copilot (PAYG)** are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.1] — 2026-07-01

### Fixed — `loop-repeat` (Copilot trapped in `git status` etc.)

Four stacked bugs in `src/client/convert.ts` and the supporting streaming
plumbing caused the model to re-propose a tool it had already received an
answer for. Each fix is independently valuable; the last one actually
stopped the loop.

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

- Diagnostic log lines in `src/provider/index.ts` (`[toolresult-diag]`)
  and `src/client/client.ts` (`[stream-diag] tool_choice forced to "any"`,
  `[stream-diag] stop_reason=`) to make future regressions traceable.
  Pending removal (see follow-ups in
  `docs/bugs/loop-repeat/findings-and-plan.md` §8).
- 5 new unit tests in `test/convert.test.ts`:
  - `converts tool results wrapped in a LanguageModelToolResult object …`
  - `extracts text from LanguageModelDataPart tool results …`
  - `drops the synthetic cache_control DataPart …`
  - `preserves LanguageModelPromptTsxPart tool results …`
  - Plus role-mapping regression coverage via the existing fixtures
    (now using explicit `ROLE_*` constants).

### Tests

- 15/15 passing in `test/convert.test.ts` (10 pre-existing + 5 new).

---

## [0.1.0] — 2026-06-XX

Initial release. PAYG-first VS Code extension that surfaces **MiniMax
M3 / M3 Priority / M2.7 / M2.7 Highspeed** inside **GitHub Copilot
Chat**, with adaptive thinking rendered as a collapsible block.

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
- **Unit tests** — 10 in `test/convert.test.ts` covering system
  extraction, text/thinking/tool-call/tool-result conversion, and
  thinking-block round-trip with signatures.
- **Build tooling** — esbuild → `dist/extension.js`; ESLint
  flat config; Prettier; `tsc --noEmit`; `npm run ltfb` =
  lint + typecheck + format + compile.

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

[0.1.1]: #011--2026-07-01
[0.1.0]: #010--2026-06-xx
