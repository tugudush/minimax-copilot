# Feature Plan: Path-Referenced Image Inlining

> Companion to [docs/bugs/vision.md](../bugs/vision.md). Vision shipped
> direct image attachment (§6 there). **This document covers the deferred
> §1b / §4 of that doc: when the user **types** an image path into chat
> (instead of dropping the image into the composer), the extension should
> resolve the path, read the file, and inline the bytes as an Anthropic
> `image` content block.**

---

## 0. Motivation

After the vision fix, `docs/foo.png` typed into the chat still arrives at
MiniMax as a plain `text` block. The Anthropic `/v1/messages` endpoint
has no filesystem access, so the model cannot open the path. The user
expects "attach image directly" **and** "reference image by path" to
both work — neither currently does on the `minimax-copilot` extension.

Reference: [tugudush/copilot-custom-endpoints](https://github.com/tugudush/copilot-custom-endpoints/blob/main/docs/models/minimax.md)
already supports path-referenced images. Their implementation likely
relies on VS Code's built-in `chat-completions` custom-endpoint provider
which inlines `#file:`-references as base64 — out of our control. **We
need to do the inlining ourselves on the user-message path.**

---

## 1. Current behavior (problem recap)

### 1a. Where the gap sits

Today, `convert.ts → buildAnthropicContentBlocks` (in
[src/client/convert.ts](../../src/client/convert.ts)) walks each
`LanguageModelChatRequestMessage.content` and emits an Anthropic block
per part. A text part is:

```ts
{ value: 'look at docs/foo.png', /* optional id */ }
```

`getPartValue` reads `part.value` and the part falls into the
`else / text` branch → emitted as `{ type: 'text', text: 'look at docs/foo.png' }`.
No image block is ever produced for a path.

### 1b. What VS Code already does for us

VS Code's `#file:` reference parser can produce a `LanguageModelDataPart`
with the file's bytes for **prompt-tsx / file-reference surface**. In
practice this is NOT reliably handed to the `languageModelChatProvider`
API for arbitrary pasted paths — Copilot Chat's chat-completions adapter
is the only consumer that consistently inlines. So we cannot rely on
VS Code doing it; we must do it ourselves **before** `convertMessages`
sees the parts.

### 1c. Real-world path shapes we must accept

| Input                                   | Shape                       | Source                       |
| --------------------------------------- | --------------------------- | ---------------------------- |
| `look at docs/foo.png`                  | bare relative path          | pasted / typed by user       |
| `./screenshots/2024-03-12.png`          | relative with `./` prefix   | pasted from file tree        |
| `../assets/logo.png`                    | upward relative             | pasted from file tree        |
| `C:\Users\me\Pictures\shot.png`         | Windows absolute            | File Explorer "copy as path" |
| `/home/me/pics/cat.jpg`                 | POSIX absolute              | shell `pwd`-style output     |
| `#file:docs/foo.png`                    | explicit `#file:` reference | VS Code chat file reference  |
| `file:///c:/Users/me/Pictures/shot.png` | `file://` URI               | drag-and-drop on macOS/Linux |

All shapes produce a candidate that needs workspace-relative
interpretation (bare relative) or direct read (absolute / URI).

---

## 2. Design

### 2a. Where the code goes

`convert.ts` must stay `vscode`-free (it is unit-tested via `tsx` with
no `vscode` module). Async filesystem access cannot live there.
**Path resolution goes in the provider**, before `convertMessages`,
and emits the same `LanguageModelDataPart` shape that `convert.ts`'s
new image branch (vision.md §6) already handles.

New file: **[`src/runtime/pathImageResolver.ts`](../../src/runtime/pathImageResolver.ts)**
(neighbor to `thinkingPartGuard.ts`, which already uses lazy
`require('vscode')`).

New file: **[`test/pathImageResolver.test.ts`](../../test/pathImageResolver.test.ts)**.

### 2b. Public API

```ts
// src/runtime/pathImageResolver.ts

/** Effective settings for path-image inline behavior for one request. */
export interface PathImageOptions {
  /** When false, the helper is a no-op. */
  enabled: boolean
  /** Skip files larger than this (bytes). 0 = no limit. */
  maxBytes: number
}

/**
 * Walk `vscodeMessages` and inline any user-message text parts whose
 * value contains a resolvable image path. Returns a new array with the
 * same role/name as the inputs, but content may now contain
 * `LanguageModelDataPart` blocks alongside text.
 *
 * Each scan-and-read pair is cancellable via `token`. Errors (ENOENT,
 * EACCES, oversize) are swallowed per-path and logged — the message
 * is always returned, with the unresolvable path left as text.
 */
export async function inlinePathImages(
  vscodeMessages: readonly vscode.LanguageModelChatRequestMessage[],
  options: PathImageOptions,
  token?: vscode.CancellationToken
): Promise<vscode.LanguageModelChatRequestMessage[]>
```

Pure helpers (testable without `vscode`):

```ts
/** Pull a list of path-shaped candidates out of a text string. */
export function extractCandidatePaths(text: string): string[]

/** True if a candidate looks like an image by extension (or by URI). */
export function isSupportedImagePath(candidate: string): boolean

/** Escape all `'`, `"`, `` ` `` chars defensively in path candidates. */
function escapeSingleQuoted(s: string): string
```

### 2c. Path normalization pipeline

For each candidate, build an ordered list of `vscode.Uri`s to try:

1. If the candidate parses as a `file://` URI → that Uri.
2. If the candidate is an absolute filesystem path → `Uri.file(p)`.
3. If `vscode.workspace.workspaceFolders` is non-empty → for each
   folder, `<folder>/<candidate>`.
4. Drop on the floor if none of the above apply (e.g. no workspace +
   relative path).

Try each Uri in order via `vscode.workspace.fs.stat` (type === File).
First match wins → read with `vscode.workspace.fs.readFile`, base64,
splice a `LanguageModelDataPart` after the text part in the result
array.

### 2d. Order preservation

If a text part contains `"see docs/a.png and docs/b.png"`, output:

```
text("see docs/a.png and docs/b.png")  →  text("see ")
                                        →  image(a.png)
                                        →  text(" and ")
                                        →  image(b.png)
```

This is what `convert.ts` already emits correctly because it walks
parts in order. The trick is the **content array** we hand to
`convert.ts` must interleave them. So we split the original text part
on each candidate's index range, slice out the path, and emit
`text` / `LanguageModelDataPart` / `text` / ... in document order.

Edge cases:

- Candidate at very start / end: leading or trailing empty text part
  is acceptable (`convert.ts` already drops empty text — verified by
  the `'skips empty messages'` test).
- Overlapping or duplicate candidates: dedupe by resolved Uri.
- Path is _inside_ a larger string like `https://example.com/foo.png?x=1`
  → reject (no path separators and no leading protocol before the
  candidate). The extractor is conservative on this — see `extractCandidatePaths`.

### 2e. Configuration (new settings in `package.json`)

```jsonc
"minimax.pathImageInline": {
  "type": "boolean",
  "default": true,
  "description": "Resolve image file paths in user messages into base64 image blocks. Disable if you don't want file reads during inference."
},
"minimax.pathImageMaxBytes": {
  "type": "integer",
  "default": 5242880,
  "minimum": 0,
  "description": "Per-image size cap for path-referenced images (bytes). 0 = no cap. Anthropic recommends ~5 MB."
}
```

New accessors in [src/config.ts](../../src/config.ts):

```ts
export function pathImageInline(): boolean {
  /* read minimax.pathImageInline, default true */
}
export function pathImageMaxBytes(): number {
  /* read minimax.pathImageMaxBytes, default 5_242_880 */
}
```

### 2f. Logging

Use the existing `logger` ([src/logger.ts](../../src/logger.ts)):

- `info` once per request where any candidate resolved, with the count:
  `Inlined N image(s) from user message paths` (paths themselves are
  not currently listed in the log line — the resolved candidates can
  always be cross-referenced with the Anthropic `messages[*].content`
  array in verbose mode).
- `warn` per unreadable candidate:
  `Skipped path-referenced image (not readable): <candidate>`.
- `warn` per oversize candidate:
  `Skipped path-referenced image (>X.X MB): <candidate>` where the
  message mentions the configured cap (e.g. `>5.0 MB`).

### 2g. Cancellation

Pass `progress / CancellationToken` from
`provideLanguageModelChatResponse` straight through. The whole walk
is wrapped in a single async helper that yields between reads so
VS Code can cancel mid-batch.

---

## 3. Implementation steps

1. **Helpers** in `src/runtime/pathImageExtractor.ts`:
   - `extractCandidatePaths(text)` — regex-based extractor that returns
     matches with start/end indices (not just strings — we need them
     for the splice).
   - `isSupportedImagePath(p)` — extension check (`.png .jpg .jpeg .gif
.webp`, case-insensitive).
   - _Note:_ an early draft listed `escapeSingleQuoted(s)` for safe
     logging; the implementation went with template-literal
     interpolation (`${candidate}`) so the helper was never written.
2. **Async core** in `src/runtime/pathImageResolver.ts`:
   - `inlinePathImages(messages, options, token)` — public entry point.
   - Lazy `require('vscode')` via the same pattern as
     `thinkingPartGuard.ts` — tests do NOT need `vscode`, they pass
     a fake reader.
   - Internal `FileReader.resolve(candidate, ctx)` is the per-call
     filesystem hook. The default reader (`createDefaultReader`)
     delegates to `resolveViaVsCode` (which uses `vscode.workspace.fs`)
     with a `resolveAbsoluteFallback` for Node-only environments
     (tests). Returns `{ data, mimeType } | null`.
3. **Wire-up** in [src/provider/index.ts](../../src/provider/index.ts):
   - Replace direct `convertMessages(messages, this.thinkingSignatures)`
     with:
     ```ts
     const prepared = await inlinePathImages(
       messages,
       { enabled: pathImageInline(), maxBytes: pathImageMaxBytes() },
       token
     )
     const { system, messages: anthropicMessages } = convertMessages(
       prepared,
       this.thinkingSignatures
     )
     ```
   - Import the helper and config accessors.
4. **Settings** in [package.json](../../package.json) — two new keys
   under `contributes.configuration.properties`; defaults documented
   in `description`.
5. **Accessors** in [src/config.ts](../../src/config.ts) — two new
   functions matching the existing `cfg().get<T>(...)` style.
6. **Unit tests** in `test/pathImageResolver.test.ts`:
   - `extractCandidatePaths` cases: bare path with ext, absolute Win,
     absolute POSIX, `#file:`, `file://` URI, no-ext path (skipped),
     URL containing a path-like suffix (skipped), multiple in one
     string.
   - `isSupportedImagePath` cases: each supported ext (case variants),
     `.txt` (false), empty string (false).
   - `inlinePathImages` integration: text part with two images → four
     parts in order (`text`, `image`, `text`, `image`); candidate
     that 404s → kept as text; candidate that exceeds cap → kept as
     text; `enabled: false` → no change. **Test uses a fake `fs`
     injected via dependency** (we'll add an overload or a `Reader`
     type) so no real `vscode` needed.
7. **Quality gates**: `npm run ltfb && npm test` must remain green.
8. **Runtime rollout**: per the README's "Updating an existing install"
   section — `npm run package` → Extensions panel → "Install from
   VSIX" → Reload Window. (The manual-copy path with full VS Code
   quit described in the older vision.md §3.7 still works but is
   no longer the recommended one.)

---

## 4. Out of scope

- Scanning **assistant-message text** or **tool-result text** for image
  paths. Only user-message input is scanned. (Confirmed in scope
  question.)
- Inlining **video / audio** paths. Even if `#file:movie.mp4` is
  resolved, the Anthropic `image` block is rejected by the API. Such
  candidates are detected by extension and silently left as text.
- **Path traversal / boundary checks**: we do not refuse paths outside
  the workspace. The user typed them; we trust them. (If we wanted
  tightening, add a `minimax.pathImageWorkspaceOnly` boolean later.)
- **Token accounting for images**: see vision.md §4. Still not
  counted in `provideTokenCount`.
- **Cancellation in the middle of a single read**: each read is a
  single `workspace.fs.readFile` call; we only check `token.isCancellationRequested`
  between candidates, not mid-read. VS Code's fs is fast enough that
  we don't lose much.

---

## 5. Verification

1. **`npm run package`** + Extensions panel → "Install from VSIX" →
   Reload Window. (The older manual-copy / full-quit flow is no
   longer recommended; see `docs/bugs/vision.md` §3.7 history.)
2. Test cases (live, after rollout):
   - In Copilot Chat with MiniMax M3, type:
     `Look at docs/foo.png — describe what you see.`
     → model should describe the image at `docs/foo.png`.
   - Same with absolute path `C:\path\to\foo.png`.
   - Same with `#file:` prefix.
   - Multiple images in one message:
     `Compare docs/a.png and docs/b.png.`
     → model should see both.
   - Typo path `docs/missing.png`:
     → extension logs the skip, leaves the text as-is, model sees the
     path but no image.
   - Toggle `minimax.pathImageInline: false` in settings, restart
     window → paths stay as text, no log line.
3. Capture the extension log at
   `%APPDATA%/Code/logs/<ts>/window1/exthost/minimax-copilot-paygo.minimax-copilot/MiniMax PAYG Copilot.log`
   and confirm `messages[*].content` for the user turn contains an
   `image` block with a base64 `source` even when the user **typed**
   the path.

---

## 6. Status — COMPLETED ✅

Implemented on 2026-07-03 on branch `feature/path-referenced-image`.

### Files touched

| File                                     | What                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/runtime/pathImageResolver.ts`       | NEW — public entry point + vscode-backed default reader with `FileReader` injection seam                |
| `src/runtime/pathImageExtractor.ts`      | NEW — pure `extractCandidatePaths` + `isSupportedImagePath` (no `vscode` deps; easy to unit-test)       |
| `src/provider/index.ts`                  | Call `inlinePathImages(...)` before `convertMessages(...)`, with config-derived `{ enabled, maxBytes }` |
| `src/config.ts`                          | Two new accessors: `pathImageInline()`, `pathImageMaxBytes()`                                           |
| `package.json`                           | Two new `minimax.*` settings with `description`                                                         |
| `test/pathImageResolver.test.ts`         | NEW — 20 tests (9 extractor, 4 supported-path, 11 resolver-integration)                                 |
| `docs/features/path-referenced-image.md` | this plan                                                                                               |

### Implementation notes

- **Lazy `vscode` everywhere** — the resolver uses
  `import type * as vscode from 'vscode'` (erased at compile time)
  and lazy `require('vscode')` for `Uri`/`workspace.fs`. Matches
  the existing `runtime/thinkingPartGuard.ts` pattern. Tests run
  under `tsx --test` without a `vscode` module installed.
- **Lazy logger** — same trick: `import * as logger from '../logger'`
  would load `vscode` and break tests; resolver wraps it in
  `getLogger()` with a noop fallback for environments where even
  that fails.
- **`FileReader` injection seam** — unit tests pass a fake
  `FileReader` that maps candidate → bytes, recording calls for
  assertions. The provider in production passes nothing and gets
  the vscode-backed default.
- **Real VS Code types via `import type`** — input type is
  `vscode.LanguageModelChatRequestMessage`, content writes use a
  permissive `MutablePart` interface (since constructed splices
  aren't full `LanguageModelTextPart` instances — `convert.ts`
  duck-types them anyway, per vision.md §6).
- **`enabled: false` short-circuits** — same array reference
  returned, so the `===` test in the resolver suite proves nothing
  was scanned.

### Quality gates

- `npx tsc --noEmit` — clean.
- `npx eslint src/ test/` — clean.
- `npm test` — **44/44 passing** (24 prior + 20 new). No prior tests
  changed.
- `npm run compile` — `dist/extension.js` rebuilt.
- `prettier --check .` — clean (auto-formatted via `format` step).

### Settings surfaced

```jsonc
"minimax.pathImageInline": {
  "type": "boolean",
  "default": true,
  "description": "Resolve image file paths in user messages into base64 image blocks. Disable if you don't want file reads during inference."
},
"minimax.pathImageMaxBytes": {
  "type": "integer",
  "default": 5242880,
  "minimum": 0,
  "description": "Per-image size cap for path-referenced images (bytes). 0 = no cap. Anthropic recommends ~5 MB."
}
```

### Runtime rollout

Per the README's "Updating an existing install" section — **`npm run
package` + Extensions panel → "Install from VSIX" → Reload Window**
is the recommended path. The atomic VSIX install + Reload Window
sequence avoids the "VS Code holds the old JS open" snag that a
manual `cp dist/extension.js` into the extensions folder can hit (the
old vision rollout doc warned about needing a "full VS Code quit" —
that was for the manual-copy path; VSIX install is cleaner and Reload
Window is sufficient).

### Verification TODO (after rollout)

Live test cases from plan §5 still pending user verification:

1. Bare path: `Look at docs/foo.png — describe what you see.`
2. Windows absolute: `C:\path\to\foo.png`.
3. `#file:` reference: `#file:docs/foo.png please describe`.
4. Multiple in one message.
5. Typo path (`docs/missing.png`) → kept as text + log warning.
6. Setting `minimax.pathImageInline: false` and restarting the window.
