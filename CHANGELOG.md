# Changelog

All notable changes to **MiniMax Copilot (PAYG)** are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added — `path-referenced-image`

- **Image paths in chat are now inlined as images.** Typing
  `docs/foo.png`, a Windows/POSIX absolute path, a `file://` URI, or a
  `#file:` reference in the Copilot Chat composer now reads the file
  and sends it to MiniMax M3 as a base64 image block, the same way
  drag-and-drop / paperclip attachment does. Previously these paths
  arrived as inert text because the Anthropic endpoint has no
  filesystem access and this extension did not perform path → base64
  inlining itself. See [`docs/features/path-referenced-image.md`](docs/features/path-referenced-image.md)
  for the design.

- **Two new settings** (opt-out friendly, defaults below):
  - `minimax.pathImageInline` — `boolean`, default `true`. Set to
    `false` if you don't want the extension to read filesystem images
    during inference.
  - `minimax.pathImageMaxBytes` — `integer`, default `5242880`
    (5 MB). Per-image size cap; `0` = no cap.

- Only user-message text is scanned. Assistant and tool-result text
  is left untouched. Out-of-scope candidates (paths outside the
  workspace that can't be resolved, over the size cap) are logged at
  `warn` and left as text — the model still sees the path.

## [0.1.0] — 2026-07-02

Initial release. PAYG-first VS Code extension that surfaces **MiniMax
M3 / M3 Priority / M2.7 / M2.7 Highspeed** inside **GitHub Copilot
Chat**, with adaptive thinking rendered as a collapsible block.

### Fixed — `vision` (image attachment silently dropped)

Direct image attachment (drag-drop, paste, paperclip) was silently
stripped from the outgoing Anthropic payload because
`buildAnthropicContentBlocks` in `src/client/convert.ts` had no branch
for `LanguageModelDataPart` carrying an `image/*` mime. Such parts
fell into the text fallback, which only read `.value` (a data part
has none), so no block was emitted at all and the model received the
user's text but no image. See
[`docs/bugs/vision.md`](docs/bugs/vision.md) for the postmortem.

- New `isImageDataPart` duck-type check + `toBase64` helper added.
- New `image` branch in `buildAnthropicContentBlocks` emits an
  Anthropic `image` content block with a base64 `source`, matching
  the four supported mimes (image/png, image/jpeg, image/gif,
  image/webp).
- `cache_control` and other non-image `DataPart`s still drop through
  the text branch and are skipped by the `if (text)` guard —
  preserving the loop-repeat fix's silent-drop behavior for the
  synthetic cache marker.

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

- 20/20 passing in `test/convert.test.ts` for the `0.1.0` scope:
  - 10 covering system extraction, text/thinking/tool-call/tool-result
    conversion, and thinking-block round-trip with signatures.
  - 5 covering the loop-repeat fixes: wrapped
    `LanguageModelToolResult` tool results, `LanguageModelDataPart`
    tool results, the synthetic `cache_control` `DataPart` drop,
    `LanguageModelPromptTsxPart` tool results, and role-mapping
    regression coverage via explicit `ROLE_*` constants in fixtures.
  - 5 covering the vision fix: `LanguageModelDataPart` → Anthropic
    `image` block, mixed text + image interleaving, jpeg mime
    passthrough, `cache_control` user-message drop (regression guard
    for the loop-repeat fix), and defensive assistant-turn image
    handling.

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

[0.1.0]: #010--2026-07-02
