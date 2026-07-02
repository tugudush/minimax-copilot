# Bug Findings and Plan: Vision / Image Input Not Working

## 0. Report

MiniMax M3 supports vision (image + video). There are two ways to give the
model an image in Copilot Chat:

1. **Attach the image directly** in the chat composer (drag-drop, paste, or
   the paperclip button).
2. **Reference an image by path** (e.g. a `#file:` reference or a pasted
   filesystem path).

Observed behavior:

| Approach              | `copilot-custom-endpoints` (OpenAI `/v1/chat/completions`) | This extension (`minimax-copilot`, Anthropic `/v1/messages`) |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| Attach image directly | ❌ does not read                                           | ❌ does not read                                             |
| Provide image path    | ✅ reads                                                   | ❌ does not read                                             |

The user accepts the `copilot-custom-endpoints` limitation (direct attach not
working there) as fine. The bug to fix is that **this extension reads images
via neither approach.**

Reference: https://github.com/tugudush/copilot-custom-endpoints/blob/main/docs/models/minimax.md

---

## 1. Root Cause

### 1a. Direct attachment — image part is silently dropped

This extension talks to MiniMax's **Anthropic-compatible** endpoint
(`HOST_GLOBAL = https://api.minimax.io/anthropic`, see
[src/consts.ts](../../src/consts.ts)), so every request is an Anthropic
Messages API payload built by [src/client/convert.ts](../../src/client/convert.ts).

The model is correctly advertised to VS Code as vision-capable:

- [src/models/registry.ts](../../src/models/registry.ts) — M3 and M3-Priority
  have `multimodal: true`.
- [src/provider/models.ts](../../src/provider/models.ts) —
  `capabilities.imageInput: info.multimodal` is `true` for M3.

So VS Code **does** deliver attached images to the provider inside
`messages[*].content` as `LanguageModelDataPart` blocks with shape:

```ts
{ data: Uint8Array, mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' }
```

But `buildAnthropicContentBlocks` in
[src/client/convert.ts](../../src/client/convert.ts) has only four branches:

1. `isToolCallPart` → `tool_use`
2. `isToolResultPart` → `tool_result`
3. `isThinkingPart` → `thinking`
4. `else` → `getPartValue(part)` as a `text` block

An image `LanguageModelDataPart` matches none of branches 1–3 and falls into
branch 4. `getPartValue` only reads `.value`:

```ts
function getPartValue(part: unknown): string {
  if (typeof part === 'string') return part
  const p = part as { value?: string | string[] }
  if (Array.isArray(p.value)) return p.value.join('')
  if (typeof p.value === 'string') return p.value
  return '' // ← image part has no .value → returns ''
}
```

Because `getPartValue` returns `''`, the `if (text)` guard in branch 4 skips
the push, so **no block is emitted at all**. The image is silently stripped
from the payload before it ever reaches MiniMax. The model receives a user
turn containing only the accompanying text (or nothing), and naturally
responds "I don't see an image."

This is the **same class of bug** as the loop-repeat issue (silently dropping
non-text parts), just on the **user-message** path instead of the tool-result
path. The prior `extractPartText` fix only covered
`LanguageModelToolResultPart.content`, not top-level user-message parts.

### 1b. Image-by-path — endpoint cannot resolve filesystem paths

When the user references an image by path (as plain text or a `#file:`
reference), this extension sends it as a `text` block. The MiniMax Anthropic
`/v1/messages` endpoint has no filesystem access and no `file://` fetch
capability, so the model cannot open the path. This extension performs no
path-to-base64 inlining of its own, so the path is just inert text.

Why `copilot-custom-endpoints` reads path-referenced images is **not verified
from code** (its OpenAI endpoint equally lacks filesystem access). Most
plausible explanations, neither confirmed:

- VS Code's built-in `chat-completions` custom-endpoint provider inlines
  `#file:`-referenced image files as base64 `image_url` content parts before
  the request leaves the client.
- Copilot Chat agent mode resolves `#file:` via a read-file tool and the
  OpenAI provider re-encodes binary reads as image data.

Either way, this extension's Anthropic conversion layer does not do any such
inlining, so path-referenced images never become image blocks.

### 1c. Net

Both failure modes collapse to the same gap: **`convert.ts` cannot turn a
`LanguageModelDataPart` (image) into an Anthropic `image` content block.**
Fixing that gap fixes direct attachment. Path-referenced images will still
not work unless/until we add explicit path resolution (out of scope for the
primary fix; see §4).

---

## 2. Required Anthropic format

Anthropic Messages API image block:

```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/png",
    "data": "<base64-encoded bytes>"
  }
}
```

Supported `media_type` values: `image/jpeg`, `image/png`, `image/gif`,
`image/webp` — all of which VS Code also produces, so passthrough is 1:1.

---

## 3. Fix Plan

Scope: [src/client/convert.ts](../../src/client/convert.ts) (primary) +
[test/convert.test.ts](../../test/convert.test.ts) (coverage).

1. **Add a `toBase64` helper** — convert `Uint8Array` / `ArrayBuffer` to a
   base64 string. Use Node's `Buffer` (available in the extension host) to
   avoid adding a dependency:

   ```ts
   function toBase64(data: Uint8Array | ArrayBufferLike): string {
     return Buffer.from(data as Uint8Array).toString('base64')
   }
   ```

2. **Add an `isImageDataPart` duck-type check**:

   ```ts
   function isImageDataPart(part: unknown): boolean {
     const p = part as { data?: unknown; mimeType?: string }
     return (
       typeof p.mimeType === 'string' &&
       p.mimeType.startsWith('image/') &&
       (p.data instanceof Uint8Array ||
         (p.data != null &&
           typeof p.data === 'object' &&
           'byteLength' in p.data))
     )
   }
   ```

3. **Add an image branch in `buildAnthropicContentBlocks`** (before the
   `else` text fallback):

   ```ts
   } else if (isImageDataPart(part)) {
     const p = part as { data: Uint8Array; mimeType: string }
     blocks.push({
       type: 'image',
       source: {
         type: 'base64',
         media_type: p.mimeType,
         data: toBase64(p.data),
       },
     })
   }
   ```

4. **Non-image data parts** (e.g. `video/*`, `audio/*`, or the synthetic
   `mimeType: 'cache_control'` part): leave in the `else` branch.
   `getPartValue` returns `''` for them and they are skipped, preserving
   current behavior (and the loop-repeat fix's `cache_control` drop). Video
   via the Anthropic surface is undocumented for MiniMax; do not emit
   unverified blocks.

   > **Deferred:** the planned `logger.debug` for dropped non-image data
   > parts was NOT added. `convert.ts` is deliberately kept free of runtime
   > `vscode` imports so it stays unit-testable in plain Node (tests run via
   > `tsx` with no `vscode` module — the same reason
   > `runtime/thinkingPartGuard.ts` uses a lazy `require`). Importing
   > `../logger` would pull in a top-level `import * as vscode from 'vscode'`
   > and break the test suite. Revisit via a lazy-require helper if
   > traceability is ever needed.

5. **Unit tests** in [test/convert.test.ts](../../test/convert.test.ts):

   - A user message with a single PNG `LanguageModelDataPart` → exactly one
     Anthropic `image` block with `source.type === 'base64'`,
     `source.media_type === 'image/png'`, and `source.data` matching
     `Buffer.from(rawBytes).toString('base64')`.
   - A user message with text + image interleaved → `[text, image]` blocks
     in order.
   - A `cache_control` data part is still dropped (regression guard for the
     loop-repeat fix).
   - An assistant message with an image part is handled without crashing
     (images normally only appear in user turns, but be defensive).

6. **Quality gates**: `npm run ltfb` (lint + typecheck + format + compile)
   and `npm test` must be green.

7. **Runtime rollout**: per repo memory, source edits do not take effect
   until `dist/extension.js` is rebuilt and reinstalled into
   `~/.vscode/extensions/minimax-copilot-paygo.minimax-copilot-0.1.0/` and
   VS Code is reloaded (fully quit first — reinstalling while VS Code holds
   the extension folder silently no-ops).

---

## 4. Out of scope / future

- **Path-referenced image inlining.** Making `docs/foo.png` typed into the
  chat work would require resolving workspace paths, reading the file, and
  emitting an image block. Not covered by this fix; the primary fix targets
  the standard "attach image" UX, which is what VS Code's `imageInput`
  capability advertises.
- **Video input.** M3 supports video on the OpenAI surface; the Anthropic
  surface is undocumented. Defer until MiniMax publishes the Anthropic video
  block shape.
- **Token accounting for images.** `provideTokenCount` in
  [src/provider/index.ts](../../src/provider/index.ts) divides character
  length by 3.5 — image bytes are not counted. Not blocking but worth a
  follow-up.

---

## 5. Verification (post-fix)

1. Rebuild + reinstall the extension (see §3.7).
2. In Copilot Chat with MiniMax M3 selected, attach a PNG directly and ask
   "what's in this image?" → model should describe it.
3. Repeat with JPEG / GIF / WebP.
4. Mix text + image in one message → model should read both.
5. Capture the extension log at
   `%APPDATA%/Code/logs/<ts>/window1/exthost/minimax-copilot-paygo.minimax-copilot/MiniMax PAYG Copilot.log`
   and confirm the `messages` array sent to `/v1/messages` now contains an
   `image` content block with a base64 `source`.

---

## 6. Implementation Status — COMPLETED ✅

Implemented on 2026-07-03. Scope: `src/client/convert.ts` (one new branch +
two helpers) and `test/convert.test.ts` (one new helper + five new tests).

### Step-by-step verification

1. **`toBase64` helper added** — normalizes `Uint8Array | ArrayBufferLike` to
   `Uint8Array`, then `Buffer.from(u8).toString('base64')`. No new dependency
   (`Buffer` is a Node global; `@types/node` is already a devDependency).

2. **`isImageDataPart` duck-type check added** — accepts `mimeType` starting
   with `image/` and `data` as either `Uint8Array` or any `ArrayBuffer`-like
   (`byteLength` present). The synthetic `cache_control` marker does NOT
   match (its mime is `cache_control`), so it still falls through and is
   dropped.

3. **Image branch added in `buildAnthropicContentBlocks`** — placed before
   the `else` text fallback; emits:

   ```ts
   { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: toBase64(p.data) } }
   ```

   The `buildAnthropicContentBlocks` JSDoc was updated to note user messages
   are now `text` and/or `image` blocks.

4. **`logger.debug` deferred** — see §3.4 note. Non-image data parts still
   drop silently via the `else` branch (unchanged behavior).

5. **Unit tests added** in `test/convert.test.ts` (new `vision / image input`
   describe block, 5 tests):
   - PNG `LanguageModelDataPart` → Anthropic `image` block (full
     `deepStrictEqual` on `source.type` / `media_type` / `data`).
   - Mixed text + image in one user message → `[text, image]` in order.
   - JPEG mime passthrough.
   - `cache_control` data part in a user message is dropped, not misread as
     an image (regression guard for the loop-repeat fix).
   - Image part in an assistant message does not crash (defensive).

   Note: assertions use `deepStrictEqual` on the whole block rather than
   `block.source?.field`. The `strictTypeChecked` ESLint config
   (`@typescript-eslint/no-unnecessary-condition`) flags `?.` on
   `block.source` here; `deepStrictEqual` sidesteps that and is a stronger
   assertion anyway.

6. **Quality gates** — `npm run ltfb` (lint + typecheck + format + compile)
   green; `npm test` reports **20/20 passing** (15 pre-existing + 5 new).

### Runtime rollout caveat

Source edits do not affect the running extension until `dist/extension.js`
is rebuilt and copied/reinstalled into
`~/.vscode/extensions/minimax-copilot-paygo.minimax-copilot-0.1.0/`, then VS
Code is reloaded (per repo memory). `npm run compile` (esbuild) rebuilds
`dist/extension.js`; the copy/reinstall + full VS Code quit is the remaining
manual step before live verification (§5).
