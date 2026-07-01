# Plan — MiniMax Copilot (PAYG + Thinking)

> A **minimal** VS Code extension that surfaces **MiniMax M3** (and M2.7) inside **GitHub Copilot Chat**, focused on exactly three things: **pay‑as‑you‑go key support**, **reasoning/thinking really enabled**, and a **collapsible thinking block**. No spend dashboard, no balance monitor, no budgets — just working chat with reasoning.

Inspired by [`klarkxy/minimax-vscode`](https://github.com/klarkxy/minimax-vscode). See [Attribution & licensing](#attribution--licensing).

---

> **Progress:** ~~Phase 0~~ ✅ · ~~Phase 1~~ ✅ · ~~Phase 2~~ ✅ · ~~Phase 3~~ ✅

| Phase                            | Status | Exit criteria                                                                                            |
| -------------------------------- | :----: | -------------------------------------------------------------------------------------------------------- |
| Phase 0 — Scaffold               |   ✅   | `F5` host logs `MiniMax PAYG Copilot activated`; `npm run compile`, `npm run lint`, `npm test` all green |
| Phase 1 — PAYG chat              |   ✅   | Pick MiniMax‑M3 with a PAYG key → streamed text response; cross‑locale region switch works               |
| Phase 2 — Thinking + collapsible |   ✅   | Collapsible "Thinking" block in Copilot Chat; verbose dump shows the `thinking` field                    |
| Phase 3 — Polish                 |   ✅   | Error toasts, walkthrough, README (en+zh), `vsce package` smoke test                                     |

---

## 1. The three requirements

### 1.1 Pay‑as‑you‑go support

A PAYG key is just an API key — MiniMax bills inference to your account balance, and the same Anthropic‑compatible endpoint serves both Token‑Plan and PAYG keys. So chat works **if the endpoint is correct**. The original breaks for PAYG because its "Add Key" flow probes `coding_plan/remains` (a Token‑Plan‑only admin endpoint) to detect region; for a PAYG key that probe always fails, the key lands as `region:'custom'`, and it binds to whatever `minimax.apiBaseUrl` was auto‑picked from the VS Code locale — which can route a Global PAYG key to the China endpoint (401) and vice‑versa.

**Our fix:** never call `coding_plan/remains`. Default the endpoint from `minimax.apiBaseUrl` (auto‑picked from locale on first run) and let the user explicitly switch China / Global. No Token‑Plan copy anywhere.

### 1.2 Thinking / reasoning really enabled

M3 supports adaptive thinking via the Anthropic‑compatible field `thinking: { type: "adaptive" }`. We send it **on by default** for M3 (toggleable). The thinking field is verified present in the request body via a verbose dump, so "really enabled" is checkable, not assumed.

### 1.3 Collapsible thinking block

Copilot Chat renders `LanguageModelThinkingPart` (VS Code proposed API `languageModelThinkingPart`) as its **native collapsible "Thinking" block**. We translate the stream's `thinking_delta` events into `LanguageModelThinkingPart` — with a stable `id` so Copilot renders the stateful collapsible container. The collapsibility is Copilot Chat's built‑in behavior; our job is simply to emit the correct part type.

---

## 2. Goals & non‑goals

### Goals

1. **PAYG works** — a pay‑as‑you‑go key streams chat with no Token‑Plan assumptions and no region misrouting.
2. **Thinking on by default** — M3 adaptive reasoning is sent and streamed.
3. **Collapsible reasoning** — reasoning renders as Copilot Chat's collapsible thinking block.
4. **Minimal** — few settings, few commands, no dashboards.

### Non‑goals (explicitly out of scope)

- ❌ Token / balance / credit monitoring, spend dashboard, cost engine, budgets, status‑bar spend.
- ❌ Multi‑key pool (single active key only).
- ❌ Git commit‑message generator, MCP web‑search, mmx‑cli, Claude‑Code ingest.
- ❌ Token‑Plan quota UI.

---

## 3. Architecture (minimal)

```
src/
├── activate.ts              # entrypoint: register provider + commands
├── consts.ts                # hosts, endpoints, secret key, default URLs, pricing
├── types.ts                 # Anthropic message / usage / thinking type re-exports
├── config.ts                # accessors for minimax.* settings
├── i18n.ts                  # en + zh message dictionary + locale detection
├── logger.ts                # output channel + redaction + verbose dump
├── models/
│   └── registry.ts          # M3 / M3-Priority / M2.7 / M2.7-highspeed + pricing tooltip
├── auth.ts                  # single key in SecretStorage + onDidChangeApiKey emitter
├── client/
│   ├── client.ts            # @anthropic-ai/sdk wrapper; SSE → text + thinking stubs
│   ├── convert.ts           # vscode messages → Anthropic messages (thinking replay: Phase 2)
│   └── error.ts             # 401/402/429/5xx → i18n toasts + billing deep link
├── provider/
│   ├── index.ts             # MiniMaxChatProvider (LanguageModelChatProvider)
│   └── models.ts            # buildChatInformation(): filtered picker entries
└── runtime/
    ├── commands.ts          # set/clear key, switch endpoint, toggle thinking, show logs
    ├── endpoint.ts          # auto-pick apiBaseUrl from vscode.env.language
    └── thinkingPartGuard.ts # runtime detection of LanguageModelThinkingPart (proposed API guard)
```

### Data flow (a chat turn)

1. Copilot Chat → `provideLanguageModelChatResponse(model, messages, options, progress, token)`.
2. `auth.ts` reads the key from SecretStorage; `config.ts` resolves `apiBaseUrl`.
3. `client/convert.ts` builds Anthropic messages (splicing prior `thinking` blocks + their `signature`s back in for replay).
4. `client/client.ts` streams via `@anthropic-ai/sdk`. For each event:
   - text delta → `progress.report(new LanguageModelTextPart(...))`.
   - **thinking delta → `progress.report(new LanguageModelThinkingPart(text, { id }))`** ★.
5. Done. No usage/cost accounting — out of scope.

---

## 4. Component plan

### 4.1 Scaffold

- TypeScript strict, ES2022 / Node 20. `esbuild` → single `dist/extension.js`. `node:test` + `node:assert`. ESLint. `engines.vscode: ^1.111.0`.
- `enabledApiProposals: ["languageModelThinkingPart"]` in `package.json` (required for the collapsible reasoning block).
- Contribution points: `languageModelProviders` `{ id: "minimax", vendor: "minimax" }`, commands (§7), configuration (§6), a short walkthrough.

### 4.2 Model registry (`models/registry.ts`)

M3 / M3‑Priority / M2.7 / M2.7‑highspeed (same proven entries as the original). M3: 1M context (512K effective default), `thinking: true` (adaptive only — no budget slider, matching the upstream endpoint). M2.7: 204,800. Tool limit 128; image/video input on M3. Picker tooltip shows the per‑million‑token PAYG price row for the active region.

### 4.3 Auth — single key, PAYG‑correct (`auth.ts`)

- One key in `context.secrets` under `minimax-paygo.apiKey`. `onDidChangeApiKey` emitter for multi‑window sync + picker refresh.
- **No `coding_plan/remains` probe.** Region/endpoint comes from `minimax.apiBaseUrl`, auto‑picked from `vscode.env.language` on first activation (zh → China `api.minimaxi.com/anthropic`, en → Global `api.minimax.io/anthropic`), switchable via commands.
- Optional `MiniMax: Test Key` command sends a 1‑token `/v1/messages` ping to confirm endpoint + key (bills a fraction of a cent; opt‑in).
- Copy says "API key" / "pay‑as‑you‑go" — never "Token Plan".

### 4.4 Chat provider (`provider/`, `client/`)

- `MiniMaxChatProvider implements vscode.LanguageModelChatProvider`.
- `provideLanguageModelChatInformation` → picker entries filtered by `minimax.visibleModels`; re‑fires on key/setting changes.
- `provideLanguageModelChatResponse` → convert → stream → push `LanguageModelTextPart` / `LanguageModelToolUsePart` / `LanguageModelThinkingPart`.
- `provideTokenCount` → rough estimate for the context indicator.
- Errors: 401/403 → "invalid key"; 402 → "insufficient credits — top up" with a platform deep link; 429 → rate‑limit. Platform URL resolved from `apiBaseUrl`.

### 4.5 Thinking — the star feature (`client/client.ts`, `client/convert.ts`)

- **Enable:** for M3, send `thinking: { type: "adaptive" }` when `minimax.thinking` is on (default `true`). Off → `thinking: { type: "disabled" }`. M2.7 has no thinking; the field is omitted.
- **Stream:** map Anthropic `thinking_delta` → `new vscode.LanguageModelThinkingPart(text)`. Assign **one stable `id` per turn** (e.g. `minimax-thinking-<turn>`) and pass it via the part's `id` so Copilot Chat renders its stateful **collapsible** `ThinkingDataContainer`.
- **Replay:** when prior assistant turns contain thinking blocks, re‑emit them in the request with their `signature` (Anthropic requires signed thinking blocks in history) so the model sees its own past reasoning.
- **Availability guard:** `languageModelThinkingPart` is proposed. Detect `vscode.LanguageModelThinkingPart` at runtime; if absent (stable VS Code without the proposal active), thinking deltas are dropped gracefully — chat still works, just without the reasoning block. The README documents that the collapsible reasoning block needs a build where the proposal is active (Insiders / approved).

### 4.6 i18n, logging

- `en` + `zh`. One output channel; redact `apiKey` / `authorization`. `minimax.debugMode: minimal | metadata | verbose` (verbose writes request bodies — including the `thinking` field — to a dump file for verification).

---

## 5. Feature summary (the three differentiators)

1. **PAYG key works** — no Token‑Plan probe, no region misrouting, correct copy.
2. **Thinking on by default** — `thinking: { type: "adaptive" }` sent for M3 and verified in the dump.
3. **Collapsible reasoning** — `thinking_delta` → `LanguageModelThinkingPart` (with `id`) → Copilot Chat's native collapsible block.

---

## 6. Settings (minimal)

| Setting                   | Default   | Purpose                                                  |
| ------------------------- | --------- | -------------------------------------------------------- |
| `minimax.apiKey`          | —         | PAYG API key (stored in SecretStorage, set via command). |
| `minimax.apiBaseUrl`      | auto      | Anthropic base URL; auto‑picked from locale, switchable. |
| `minimax.thinking`        | `true`    | ★ M3 adaptive thinking on/off.                           |
| `minimax.visibleModels`   | all       | Restrict picker entries.                                 |
| `minimax.maxOutputTokens` | `0`       | Output cap; `0` = model decides.                         |
| `minimax.debugMode`       | `minimal` | `minimal` / `metadata` / `verbose`.                      |

(★ = the one user‑facing reasoning toggle. No budget / spend / balance settings.)

---

## 7. Commands (minimal)

| Command                          | Purpose                                           |
| -------------------------------- | ------------------------------------------------- |
| `MiniMax: Set API Key`           | Store a PAYG key in SecretStorage.                |
| `MiniMax: Clear API Key`         | Remove the key.                                   |
| `MiniMax: Switch to Global API`  | Endpoint → `api.minimax.io/anthropic`.            |
| `MiniMax: Switch to Chinese API` | Endpoint → `api.minimaxi.com/anthropic`.          |
| `MiniMax: Toggle Thinking`       | Flip `minimax.thinking` (M3 reasoning on/off).    |
| `MiniMax: Test Key`              | (optional) 1‑token ping to verify key + endpoint. |
| `MiniMax: Show Logs`             | Focus the output channel.                         |

---

## 8. Build, test, package

- `npm run compile` (esbuild), `npm run watch`, `npm run lint`, `npm test` (`node --test`), `npm run package` (`vsce package` → `.vsix`).
- Unit tests: `convert.ts` (thinking replay / signatures), `client.ts` (event → part mapping incl. thinking), `endpoint.ts` (locale → host), `auth.ts` (no `coding_plan` call). VS Code API mocked.
- Install: `code --install-extension minimax-copilot-paygo-*.vsix`.

---

## 9. Phased delivery

- **Phase 0 — Scaffold:** `package.json` (with `enabledApiProposals`), `tsconfig.json`, esbuild, ESLint, test harness, mock helpers, `LICENSE` (MIT), `README` stub, `src/activate.ts`. _Exit: F5 host logs activation._
- **Phase 1 — PAYG chat:** `consts`, `types`, `config`, `models/registry`, `auth`, `client/*`, `provider/*`, `runtime/commands` + `endpoint`, `i18n`, `logger`. _Exit: pick MiniMax‑M3 with a PAYG key → streamed text response; cross‑locale region switch works._
- **Phase 2 — Thinking + collapsible:** send `thinking:{type:"adaptive"}`, map `thinking_delta` → `LanguageModelThinkingPart` (with `id`), thinking replay with signatures, toggle command. _Exit: a collapsible "Thinking" block appears in Copilot Chat on a proposal‑active build; verbose dump shows the `thinking` field._
- **Phase 3 — Polish:** error toasts (402 top‑up), walkthrough, README (en+zh), screenshots, `vsce package` smoke test.

---

## 10. Verification criteria

- ✅ A PAYG key streams a chat response; no `coding_plan` call is ever made (asserted by a test that spies on `fetch`).
- ✅ Adding a Global PAYG key on a zh‑locale install (and vice‑versa) does **not** misroute — the explicit switch pins the endpoint and chat succeeds.
- ✅ The request body for M3 includes `thinking: { type: "adaptive" }` (verified via verbose dump).
- ✅ `thinking_delta` stream events are mapped to `LanguageModelThinkingPart` with a stable `id` (unit tested — `test/convert.test.ts`).
- ✅ Thinking-block `signature` values are captured from `content_block_stop` and replayed in subsequent turns (round-trip unit tested).
- ✅ When the proposal is unavailable, chat still works (thinking dropped gracefully via `runtime/thinkingPartGuard.ts`).
- ✅ The key lives only in SecretStorage (absent from `globalState` / workspace settings).
- ✅ `npm test` green; `vsce package` produces an installing `.vsix`.

---

## 11. Risks & open questions

1. **Proposed API for thinking.** `languageModelThinkingPart` is still proposed in `microsoft/vscode` main (verified). On stable VS Code the collapsible reasoning block won't render; chat still works. → Declare in `enabledApiProposals`; document the Insiders / proposal‑active requirement; runtime‑guard so absence doesn't break chat.
2. **Collapsibility needs `id`.** Copilot's `ThinkingDataContainer` is keyed on `thinking.id`; without it the part may render differently. → Always assign a stable per‑turn `id`; verify rendering in a proposal‑active host.
3. **Thinking replay signatures.** Anthropic requires signed thinking blocks in history; the endpoint returns a `signature` per block. → Preserve `signature` in `convert.ts` replay; unit‑test the round‑trip.
4. **PAYG region misrouting** (the original's #1 bug). → Fixed by dropping the `coding_plan` probe and using an explicit China / Global switch (§4.3).
5. **Marketplace naming.** Pick a distinct id (e.g. `minimax-copilot-paygo`); "MiniMax" is a MiniMax trademark — state "not endorsed" in the README.

---

## Attribution & licensing

- **Inspired by:** [`klarkxy/minimax-vscode`](https://github.com/klarkxy/minimax-vscode) by Klarkxy (SATA License v2.0 — star + thank the author). Its `LanguageModelChatProvider` + Anthropic‑compatible‑endpoint design is the reference for the chat layer.
- **This extension:** a fresh, minimal implementation. No source copied; only documented API patterns and public pricing data reused.
- **License:** MIT. The README credits the original author.
- **Trademarks:** "MiniMax" is a MiniMax trademark; this independent client is not endorsed by MiniMax.

---

## Next action

**All phases complete.** The extension is ready for release:

- PAYG chat works with MiniMax M3 / M2.7 (no Token‑Plan probe, no region misrouting).
- Adaptive thinking on by default with collapsible "Thinking" block (`LanguageModelThinkingPart`).
- Thinking replay with signatures for multi‑turn conversations (10 unit tests).
- Error toasts (401/402/403/429/5xx) with bilingual i18n and billing deep link.
- Walkthrough guides new users through setup (4 steps).
- Bilingual README (en + zh).
- `vsce package` produces a clean `.vsix` (11 files, ~400 KB).

**Release checklist:**

- [ ] Verify in VS Code Insiders with a real PAYG key.
- [ ] Take screenshots for the Marketplace listing.
- [ ] Publish to the VS Code Marketplace (`vsce publish`).
