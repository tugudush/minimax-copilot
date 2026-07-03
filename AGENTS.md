# AGENTS.md — MiniMax Copilot (PAYG)

> Minimal VS Code extension that surfaces **MiniMax M3 / M2.7** inside
> **GitHub Copilot Chat** with pay-as-you-go key support and collapsible
> reasoning.

## Build / Test / Lint

```bash
npm install
npm run ltfb       # lint + typecheck + format + compile (full check)
npm test           # node:test runner, no VS Code needed for unit tests
npm run package    # vsce package → .vsix
npm run watch      # esbuild --watch for dev
```

- **`npm run ltfb`** is the canonical green-build gate — run it before committing.
- Tests live in `test/**/*.test.ts` and run with `node --import tsx --test`.
  Test files use plain duck-typed shapes (mirroring
  `vscode.LanguageModelChatRequestMessage`) plus a `FileReader` injection
  seam — **do not import `vscode`** in tests; the `vscode` module is not
  resolvable in plain Node.
- ESLint uses `typescript-eslint`'s `strict-type-checked` + `stylistic-type-checked`
  configs (see `eslint.config.mjs`). Unused vars tolerating underscore prefix.

## Architecture

Single-entry, tree-shakeable layout. See `docs/plan.md` §3 for the
full data-flow diagram.

```
src/
├── activate.ts              # extension entrypoint
├── consts.ts                # hosts, model IDs, secrets, pricing
├── config.ts                # live `minimax.*` setting accessors (no caching)
├── auth.ts                  # SecretStorage + onDidChangeApiKey emitter
├── logger.ts                # output channel + redact(sk-..., Bearer ...)
├── i18n.ts                  # en + zh message dictionary
├── types.ts                 # Anthropic shape re-exports
├── models/registry.ts       # M3 / M3-Priority / M2.7 / M2.7-Highspeed
├── provider/                # MiniMaxChatProvider (LM chat provider)
├── client/                  # @anthropic-ai/sdk wrapper: streaming, convert, error
└── runtime/
    ├── commands.ts          # set/clear key, switch endpoint, toggle thinking
    ├── endpoint.ts          # auto-pick apiBaseUrl from vscode.env.language
    ├── pathImageExtractor   # pure regex path matching (vscode-free)
    ├── pathImageResolver    # fs read → LanguageModelDataPart splice
    └── thinkingPartGuard    # dynamic require for proposed-API guard
```

## Conventions (deviations from defaults)

- **TypeScript strict + `noUncheckedIndexedAccess` + `noImplicitOverride`**
  (see `tsconfig.json`). Use `?? defaultValue` / explicit bounds —
  array indices may be `undefined`.
- **esbuild** bundles to a single `dist/extension.js` (CJS, Node 20).
  No webpack/Vite. `vscode` is the only `external`.
- **No `import 'vscode'` in files that need to be unit-testable**
  (e.g. `runtime/pathImageExtractor.ts`, anything imported transitively
  by `test/**`). Anything that needs `vscode` at runtime must use the
  dynamic-`require` pattern in `runtime/thinkingPartGuard.ts`.
- **No caching of config reads**: `src/config.ts` re-reads
  `vscode.workspace.getConfiguration` on every call. Settings changes
  are picked up live via `onDidChangeConfiguration`.
- **API key lives only in `context.secrets`** — never in settings,
  `globalState`, or logs. `src/logger.ts` redacts `sk-…`, `Bearer …`,
  `"x-api-key":"..."` before writing.
- **Region is a user choice, not a probe**. Don't add a
  `coding_plan/remains` admin-endpoint probe (it breaks PAYG keys).
  Use `minimax.switchToGlobal` / `minimax.switchToChina` commands
  and persist via `minimax.apiBaseUrl`.
- **i18n**: wrap user-facing strings in `t(...)` from `src/i18n.ts`.
  Locale is detected from `vscode.env.language`; only `en` + `zh` are shipped.
- **Tests**: pure-Node `node:test`. Mock the `vscode` shape, not the
  real module. See `test/convert.test.ts` and `test/pathImageResolver.test.ts`.

## Pitfalls

- **`languageModelThinkingPart` is a VS Code proposed API.** It is only
  present in Insiders / approved builds. Guard every use with
  `getThinkingPartCtor()` from `runtime/thinkingPartGuard.ts`.
  When `null`, drop thinking deltas silently (the README documents this).
- **Thinking-block `id`s must be stable across turns** so Copilot Chat
  renders the stateful collapsible container. Use the
  `${THINKING_ID_PREFIX}-<turn>-<block>` pattern from `provider/index.ts`
  and store signatures in `thinkingSignatures` for replay in
  `client/convert.ts`.
- **`LanguageModelDataPart` must be emitted as an Anthropic `image`
  block, not as a text fallback.** The bug postmortem at
  `docs/bugs/vision.md` describes what happens when `convert.ts`
  ignores data parts — image attachment silently disappears.
- **Path-image inlining is opt-out but enabled by default.**
  `runtime/pathImageResolver.ts` scans only **user-message text** for
  paths; assistant/tool-result text is left alone. Out-of-scope
  candidates (too big, not found, outside workspace) are logged at
  `warn` and left as text — the model still sees the path. See
  `docs/features/path-referenced-image.md`.
- **Anthropic endpoint ≠ Anthropic SDK defaults.** `consts.ts` defines
  `HOST_GLOBAL` / `HOST_CHINA`; the `client/` layer is **not** allowed
  to assume `api.anthropic.com`. The endpoint is selected via
  `runtime/endpoint.ts` from locale + user override.
- **`minimax.maxOutputTokens = 0` ⇒ let the model decide.** Don't
  clamp to a hardcoded floor.
- **Token count is rough** (`Math.ceil(length / 3.5)`). Don't claim
  it's accurate.

## Where to look first

| Topic                                | File / Doc                                       |
| ------------------------------------ | ------------------------------------------------ |
| Big-picture / phase plan             | `docs/plan.md`                                   |
| Anthropic message conversion         | `src/client/convert.ts`                          |
| Streaming → LM parts                 | `src/client/client.ts`                           |
| Model registry & picker tooltip      | `src/models/registry.ts`                         |
| PAYG region / endpoint selection     | `src/runtime/endpoint.ts` + `src/consts.ts`      |
| Thinking render + replay             | `src/runtime/thinkingPartGuard.ts` + `provider/` |
| Vision bug postmortem                | `docs/bugs/vision.md`                            |
| Path-image feature design            | `docs/features/path-referenced-image.md`         |
| M3 Priority variant (tier-only diff) | `docs/m3-priority.md`                            |
| Releasing to Marketplace             | `docs/publishing.md`                             |
| Setting up a fresh dev env           | `walkthroughs/setup/welcome.md`                  |

## Don't

- ❌ Add a Token-Plan dashboard, balance monitor, or cost engine.
  (Explicit non-goal — see `docs/plan.md` §2.)
- ❌ Persist the API key outside `SecretStorage`.
- ❌ Call `coding_plan/remains` or any Token-Plan-only admin endpoint.
- ❌ Probe endpoints to detect region — region is user-chosen.
- ❌ Import `vscode` from `runtime/pathImageExtractor.ts` or any file
  it depends on; tests must stay `vscode`-free.
- ❌ Bundle the Anthropic SDK default endpoint; honor `HOST_GLOBAL` /
  `HOST_CHINA` and the user-set `minimax.apiBaseUrl`.
