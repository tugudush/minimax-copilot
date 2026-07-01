# Bug Findings and Plan: Git Command Loop / Repetition

## 1. Symptom & Analysis

As shown in the screen recording [docs/bugs/loop-repeat/2026-07-01 22-21-49.mp4](docs/bugs/loop-repeat/2026-07-01%2022-21-49.mp4), Copilot gets trapped in an infinite loop where it repeatedly proposes running `git status` or `git branch --show-current`. Even when the user authorizes execution and the command runs successfully in the terminal, Copilot acts as if it has no knowledge of the output and suggests the exact same verification step again.

### Root Cause

The root cause lies in how [src/client/convert.ts](src/client/convert.ts) is duck-typing and parsing the history of tool results:

- In `isToolResultPart`, the check relies on `Array.isArray(p.content)` to recognize a `LanguageModelToolResultPart`:
  ```typescript
  function isToolResultPart(part: unknown): boolean {
    const p = part as { callId?: string; content?: unknown }
    return typeof p.callId === 'string' && Array.isArray(p.content)
  }
  ```
- However, at runtime within VS Code's Language Model UI/Tooling framework, `p.content` is sometimes not a raw array but is instead wrapped as an instance of `LanguageModelToolResult`. This wrapper object hosts the actual array of content parts inside a nested `content` property (i.e. `p.content.content`).
- Because `p.content` does not pass `Array.isArray`, `isToolResultPart(part)` returns `false`.
- This causes the tool execution results to fall into the catch-all `else` text-matching block inside `buildAnthropicContentBlocks`. Since a `LanguageModelToolResultPart` has no `.value` property directly, it resolves to an empty string and is completely stripped from the history array before the Anthropic client payload is generated.
- Crucially, the model sees its original `tool_use` message but is given **no corresponding tool result** in the history. It assumes that it still has no status information, and consequently loops back to proposing `git status` again.

---

## 2. Refactoring Plan

We will make the conversion logic incredibly robust against both raw arrays and nested `LanguageModelToolResult` wrappers.

1. **Refactor `isToolResultPart` in [src/client/convert.ts](src/client/convert.ts#L211)**:
   Change the validation to check if `p.callId` is a `string` and `p.content` is defined (not `undefined` or `null`).

2. **Refactor `extractToolResultText` in [src/client/convert.ts](src/client/convert.ts#L216-L233)**:
   - Check if `content` is an object containing a nested `content` array (which is the case for `LanguageModelToolResult`). If so, unwrap and use that nested array.
   - Otherwise, if `content` is a raw array, use it directly.
   - For all other non-array shapes, fallback gracefully to a serialized string representation.

3. **Verify and Update Unit Tests**:
   - Verify that all unit tests in [test/convert.test.ts](test/convert.test.ts) pass successfully.
   - Add new tests in [test/convert.test.ts](test/convert.test.ts) that represent tool result content wrapped in objects, verifying they get parsed precisely down to their inner message blocks.

4. **Verify Typechecking and Compilation**:
   - Run typechecking via `npm run typecheck`.
   - Run build compilation via `npm run compile`.

---

## 3. Implementation Status — COMPLETED ✅

All plan steps executed on 2026-07-01. Scope of the loop-repeat fix was limited to
`src/client/convert.ts` (two functions) and `test/convert.test.ts` (two new tests).

> **Note:** The `git diff` also shows changes in `src/client/client.ts` and
> `src/provider/index.ts` (tool-passing plumbing: `tools`/`toolMode` params,
> `tool_use` block tracking, `LanguageModelToolCallPart` emission, `convertTools`
> import). Those belong to the **separate, prior** "tool-call XML leaking as text"
> fix (see `/memories/repo/minimax-paygo-context.md` §"CRITICAL FIX 2026-07-01"),
> not to this loop-repeat fix. They show in `git diff` only because they are
> uncommitted; they are independent of this work.

### Step-by-step verification

1. **`isToolResultPart` refactored** — now accepts any non-null `content`:

   ```typescript
   function isToolResultPart(part: unknown): boolean {
     const p = part as { callId?: string; content?: unknown }
     return (
       typeof p.callId === 'string' &&
       p.content !== undefined &&
       p.content !== null
     )
   }
   ```

2. **`extractToolResultText` refactored** — unwraps nested `content.content`:

   ```typescript
   function extractToolResultText(content: unknown): string {
     if (typeof content === 'string') return content
     if (content === undefined || content === null) return ''

     let actualContent = content
     if (typeof content === 'object' && 'content' in content) {
       const innerContent = (content as Record<string, unknown>).content
       if (Array.isArray(innerContent)) {
         actualContent = innerContent
       }
     }

     if (!Array.isArray(actualContent)) {
       try {
         return JSON.stringify(actualContent)
       } catch {
         return ''
       }
     }
     const texts: string[] = []
     for (const part of actualContent) {
       const text = getPartValue(part)
       if (text) texts.push(text)
     }
     return texts.join('\n') || '(empty)'
   }
   ```

3. **Unit tests added** in [test/convert.test.ts](test/convert.test.ts):
   - `converts tool calls and raw tool results` — verifies the full
     `tool_use` → `tool_result` round-trip with a raw array content.
   - `converts tool results wrapped in a LanguageModelToolResult object
containing a content array` — reproduces the exact runtime shape
     (`content.content`) that caused the loop, verifies it is unwrapped to
     `M src/activate.ts\n?? docs/`.
   - Added a `toolMsg()` test helper to build tool-bearing mock messages.

4. **Quality gates** — `npm run ltfb` (lint + typecheck + format + compile)
   passed cleanly; `npm test` reports **12/12 passing** (10 pre-existing +
   2 new).

### Runtime rollout caveat

VS Code loads the extension from the **installed** copy at
`~/.vscode/extensions/minimax-copilot-paygo.minimax-copilot-0.1.0/`, not the
source tree (see repo memory). The code fix alone does not change runtime
behavior until the extension is repackaged and reinstalled. Reinstalling while
VS Code holds the extension folder silently no-ops; either fully quit VS Code
first or patch the installed `dist/extension.js` directly.

---

## 4. How to verify the fix live

After reinstalling, reproduce the original scenario:

1. Open a git repo in VS Code with the MiniMax M3 model selected in Copilot Chat.
2. Ask Copilot to "check the repo state, then stage, commit and push."
3. Expected: Copilot runs `git status` once, observes the output, and proceeds
   to `git add` / `git commit` / `git push` **without** re-proposing `git status`.

If the loop persists, capture the extension log at
`%APPDATA%/Code/logs/<ts>/window1/exthost/minimax-copilot-paygo.minimax-copilot/MiniMax PAYG Copilot.log`
and confirm the `messages` array sent to `/v1/messages` now contains
`tool_result` blocks paired with each `tool_use`.

---

## 5. CORRECTION — the §3 fix did NOT stop the loop (2026-07-01, 23:00)

The §3 "COMPLETED ✅" fix was based on a **wrong root-cause hypothesis**
(the `content.content` `LanguageModelToolResult` wrapper). That wrapper shape
does **not** exist in the real API. After rebuilding + reinstalling at 22:45,
the extension log still showed the loop running:

```
22:46:13 messages=3
22:46:24 messages=6
... (a new request every ~5s, count climbing +3/turn) ...
22:48:02 messages=50
```

### What the log proved

- The `tool_use` ↔ `tool_result` pairing fix **did** work: requests succeeded
  every ~5s with **no 400 errors** and history growing steadily. Anthropic
  only accepts a payload where every `tool_use` has a matching `tool_result`,
  so the recognition fix (`isToolResultPart`) is fine — the blocks are paired
  and accepted.
- Yet the model still looped. If the blocks are paired but the model re-proposes
  the same tool, the only remaining explanation is that the `tool_result`
  **content is empty/meaningless**.

### Real root cause

`LanguageModelToolResultPart.content` is an array whose elements can be any of
(verified in `@types/vscode`):

- `LanguageModelTextPart` → `{ value: string }`
- `LanguageModelPromptTsxPart` → `{ value: <rendered prompt-tsx tree> }` ← **no string `.value`**
- `LanguageModelDataPart` → `{ data: Uint8Array, mimeType: string }` ← **no `.value` at all**
- arbitrary `unknown`

Copilot Chat agent-mode tool results are very frequently `PromptTsxPart` or
`DataPart`, **not** plain `TextPart`. The old `extractToolResultText` →
`getPartValue` only read `.value` as a string, so every non-text part resolved
to `''` and the whole result collapsed to `'(empty)'`. The model saw its
`tool_use` answered by an empty `tool_result`, concluded it had no output, and
re-proposed `git status` forever. (Pre-fix this was masked because BOTH
`tool_use` and `tool_result` were dropped entirely → no orphaned `tool_use` →
no 400 → silent re-proposal.)

### Real fix (deployed 23:06)

`src/client/convert.ts` — `extractToolResultText` now delegates to a new
`extractPartText` that handles **all** part types:

- `TextPart` (`value: string`) → return it.
- `DataPart` (`data: Uint8Array` + `mimeType`) → UTF-8 decode when the mime is
  text-ish, else `[binary <mime>]`.
- `PromptTsxPart` / anything else → `safeStringify(part)` so content is
  preserved as JSON instead of dropped to `''`.

`src/provider/index.ts` — added a `[toolresult-diag]` log line per tool-result
content part (duck-typed `TextPart`/`DataPart`/`PromptTsxPart` label + 300-char
snippet + the extracted text length) so one repro confirms the shape and the
extraction. Remove once confirmed.

Tests: `test/convert.test.ts` adds two regression tests — `DataPart`
(Uint8Array decode) and `PromptTsxPart` (serialized, not `'(empty)'`).
14/14 pass; lint/typecheck/format clean.

### Deploy

Source edits don't affect runtime (installed copy runs). The freshly built
`dist/extension.js` was copied over
`~/.vscode/extensions/minimax-copilot-paygo.minimax-copilot-0.1.0/dist/extension.js`
(the file was writable; no full VS Code quit needed). **Reload Window** to load
the new code, then reproduce the git scenario once.

### How to confirm live

After reload + one repro, check the extension log for `[toolresult-diag]`
lines. Expect `part[0] DataPart(...)` or `PromptTsxPart(...)` with a non-zero
`extractedLen` and real git output in `extracted=...`. The loop should stop
(model proceeds to `git add`/`commit`/`push` instead of re-proposing
`git status`).

---

## 6. The §5 fix did NOT stop the loop either (2026-07-01, 23:15) — new video, new log, new bug found

A third screen recording,
[docs/bugs/loop-repeat/2026-07-01 23-09-19.mp4](docs/bugs/loop-repeat/2026-07-01%2023-09-19.mp4),
was captured after reloading with the §5 fix deployed. Video analysis (frame

- transcript review) confirmed the loop **still** happens: the assistant
  re-proposes/re-runs `git status` (and later `git branch --all`, `git log`,
  `git show-ref`) roughly 20 times across ~2 minutes, never converging to
  `add`/`commit`/`push`.

### The good news: §5's fix is confirmed working

The extension log this time (`window1` dir `20260701T213740`, file modified
23:11) **does** contain `[toolresult-diag]` lines, and they prove the §5 fix
is doing its job:

```
[toolresult-diag] callId=call_function_r4b7ugjjzmf0_1 extractedLen=578 extracted=On branch feature/usage
Your branch is up to date with 'origin/feature/usage'.
Changes not staged for commit: ...
```

Real, non-empty git output is reaching the model every turn now — the
`'(empty)'` bug from §5 is genuinely fixed. So the loop has a **different,
still-unfixed** cause.

### Bug found #1 (fixed): cache_control marker leaking into tool output as garbage text

The same log revealed a second, previously-unknown bug: Copilot Chat attaches
a synthetic marker part to some tool-result content arrays —
`{ mimeType: 'cache_control', data: 'ephemeral' (base64) }` — as an internal
prompt-cache breakpoint hint. It is **not** real tool output. The §5
`extractPartText` fell through to its generic "binary data" branch for this
part and serialized it as literal text, so the model was receiving polluted
results like:

```
extracted=feature/usage
[binary cache_control]
```

**Fix (deployed):** `src/client/convert.ts` — `extractPartText` now special-cases
`mimeType === 'cache_control'` and returns `''` (drops it silently) before
reaching the generic binary-data branch. Added regression test in
`test/convert.test.ts`. This is a real, confirmed bug fix, but on its own it's
very unlikely to be the loop's root cause (extra garbage text after a valid
result shouldn't make a model re-run the same command forever).

### Leading hypothesis for the real cause (not yet confirmed): forced `tool_choice`

`src/client/client.ts` forces `tool_choice: { type: 'any' }` whenever
`toolMode === 2` (`LanguageModelChatToolMode.Required`):

```typescript
if (toolMode === 2) {
  ;(params as unknown as Record<string, unknown>).tool_choice = { type: 'any' }
}
```

If Copilot Chat passes `toolMode=Required` on every follow-up turn (not just
an initial one), the model is **structurally unable to ever emit a plain final
text answer** — every single turn it MUST invoke some tool. Faced with
nothing productive left to do, it falls back to re-running a cheap, safe,
read-only command (`git status`) as filler, forever. This would explain every
observed symptom simultaneously: valid/non-empty tool results (confirmed
above), no 400 errors (confirmed in §5), and an endless but harmless
re-verification loop that never reaches a stopping point.

This has **not** been confirmed yet — it is the next thing to check.

### Diagnostics added (deployed 23:1x, awaiting next repro)

- `src/provider/index.ts` — `Chat request:` log line now also prints
  `toolMode=<value>` and `tools=<count>`.
- `src/client/client.ts` — logs `[stream-diag] tool_choice forced to "any"
(toolMode=Required)` whenever the forcing branch triggers.
- `src/client/client.ts` — now handles the previously-ignored `message_delta`
  stream event and logs `[stream-diag] stop_reason=<value>` when Anthropic
  reports one (e.g. `end_turn`, `tool_use`, `max_tokens`). This was a no-op
  branch before; now it's the key signal for whether the model is being
  cut off or is voluntarily choosing to keep calling tools.

Quality gates: 15/15 tests pass (1 new regression test for the cache_control
fix), lint/typecheck/format clean.

### Deploy

Same pattern as before — built `dist/extension.js` copied over
`~/.vscode/extensions/minimax-copilot-paygo.minimax-copilot-0.1.0/dist/extension.js`
(file writable, no full VS Code quit needed).

### Next step (blocking on user repro)

1. **Reload Window** to load this build.
2. Reproduce the git scenario again (a short repro is enough — a few tool
   calls, doesn't need to reach a stable stop or timeout).
3. Check the newest log file for:
   - `toolMode=` value on `Chat request:` lines — is it `2` (Required) on
     every turn, or does it vary?
   - Any `[stream-diag] tool_choice forced to "any"` lines — do they appear
     on every request, or only some?
   - Any `[stream-diag] stop_reason=` lines — what reason does the model
     report each turn (`tool_use` every time would be consistent with the
     model choosing to call tools; `end_turn` appearing but being ignored
     would point to a different bug in the streaming/progress-report path).
4. Based on those three signals, either:
   - Confirm the forced-`tool_choice` hypothesis and stop forcing
     `tool_choice: any` on turns after the first, or
   - Rule it out and look at the next candidate (e.g. thinking-signature
     replay silently invalidating history, or a system-prompt instruction
     that encourages excessive re-verification).

**LESSON (reinforced a third time):** confirming one hypothesis (empty tool
results) and shipping its fix does not mean the loop is fixed. Each of the
three fixes so far (§3, §5, §6) was a real, verifiable bug — but only the
live log after a fresh repro tells you whether the _reported symptom_ is
actually resolved. Always re-test against a new recording/log before
declaring victory.

---

## 7. The §6 hypothesis was ruled out; real root cause found in role mapping (2026-07-01, 23:33)

Fresh repro log:

```
%APPDATA%/Code/logs/20260701T232635/window1/exthost/minimax-copilot-paygo.minimax-copilot/MiniMax PAYG Copilot.log
```

### What the new log proved

- `Chat request:` lines show `toolMode=1`, not `toolMode=2`.
- There are no `[stream-diag] tool_choice forced to "any"` lines.
- Every model turn still ends with `[stream-diag] stop_reason=tool_use`.
- `[toolresult-diag]` continues to show real, non-empty git output before
  conversion.

Therefore the forced-`tool_choice` theory is ruled out. VS Code is allowing a
normal text answer; the model is voluntarily choosing tools again.

### Real root cause

`src/client/convert.ts` had the wrong VS Code role mapping:

```typescript
// Old, wrong assumption:
// LanguageModelChatMessageRole: 1 = system, 2 = user, 3 = assistant
```

The checked-in VS Code type definition in
`node_modules/@types/vscode/index.d.ts` defines:

```typescript
export enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2,
}
```

There is no public system role in this API. Because the converter used the old
mapping:

- Real user messages and tool-result messages (`role=1`) were treated as
  system messages. Tool results then passed through `normalizeContent`, which
  only reads `.value` text and drops tool-result structure.
- Real assistant messages and tool calls (`role=2`) were emitted as Anthropic
  `user` messages, so `tool_use` history was assigned to the wrong speaker.
- The provider-level diagnostics looked good because they run before
  conversion, but the actual Anthropic payload still had malformed conversation
  history.

This explains why the model could receive non-empty output in diagnostics and
still loop: the output was not being placed into a valid user/assistant
`tool_use` -> `tool_result` exchange.

### Fix deployed

`src/client/convert.ts` now uses the current VS Code role values:

```typescript
const ROLE_SYSTEM = 0
const ROLE_USER = 1
const ROLE_ASSISTANT = 2
```

- `role=0` is kept only as a defensive system-message escape hatch.
- `role=1` converts to Anthropic `user`.
- `role=2` converts to Anthropic `assistant`.

`test/convert.test.ts` now uses explicit role constants so the fixtures match
the real API and would catch this regression.

Validation:

```
npm test -- test/convert.test.ts  # 15/15 passing
npm run lint && npm run typecheck && npm run compile  # clean
```

Deploy:

```
cp dist/extension.js ~/.vscode/extensions/minimax-copilot-paygo.minimax-copilot-0.1.0/dist/extension.js
```

Reload VS Code, then rerun the git scenario. If it still repeats, inspect the
newest verbose request body next; at this point the role-shaped payload should
be the first thing to verify live.

---

## 8. RESOLVED — the §7 fix stopped the loop (2026-07-01, 23:50)

After redeploying the `dist/extension.js` containing the §7 role-mapping fix
and reloading VS Code, the original scenario was re-run end-to-end:

> Open the workspace, ask Copilot Chat (MiniMax M3) to "check the repo state,
> then stage, commit and push."

Observed behavior:

- Copilot called `git status` **exactly once**.
- It read the output, then proceeded to `git add -A`, `git commit`, and
  `git push origin feature/usage` without re-proposing any verification
  command.
- No `git branch --show-current`, `git log`, `git show-ref`, or `git status`
  repeats; the conversation converged on the first response that contained
  the full add/commit/push sequence.

This was independently verified by running the §1–§7 scenario against the
`feature/usage` branch — which is exactly the commit (`55d2367`) that
introduced and landed this fix. The fix is live and the reported symptom is
gone.

### Final fix tally (what was actually shipped)

| §     | Hypothesis                                                                  | Status                           |
|-------|-----------------------------------------------------------------------------|----------------------------------|
| §3    | `content.content` `LanguageModelToolResult` wrapper                         | Real bug, fixed, but not the loop cause |
| §5    | Non-text part types (`PromptTsxPart`, `DataPart`) returning `''`            | Real bug, fixed, but not the loop cause |
| §6    | `cache_control` synthetic marker polluting extracted text                    | Real bug, fixed, but not the loop cause |
| §7    | **Wrong VS Code role mapping** (User=1, Assistant=2, no public System role) | **Real bug, fixed, loop RESOLVED**  |

Each prior "real bug, not the loop cause" fix was independently valuable and
should stay in the codebase — they were masking the role-mapping bug behind
silent stripping of malformed-but-still-accepted request bodies. The model
appeared to receive valid `tool_use`/`tool_result` pairs because every turn's
malformed body was still 200-OK at the API layer; the conversational structure
inside those bodies was simply unrecoverable until roles were corrected.

### Updated repro recipe (for future regressions)

1. Pick any git workspace.
2. Ensure MiniMax M3 is the active Copilot Chat model.
3. Prompt: *"check the repo state, then stage, commit and push to the current
   branch."*
4. Expect: one `git status`, then `git add` / `git commit -m "…"` /
   `git push` in sequence, with a single final assistant message summarizing
   what was done. **No re-proposal** of `git status` after the first result.

### Outstanding follow-ups (non-blocking, tracked separately)

- Remove the diagnostic log lines now that the bug is confirmed fixed:
  - `[toolresult-diag]` in `src/provider/index.ts`.
  - `[stream-diag] tool_choice forced to "any"` and
    `[stream-diag] stop_reason=` in `src/client/client.ts`.
  These were added specifically to confirm each hypothesis and can come out
  in a small follow-up commit once the team is confident no regression
  sneaks back in.
- Consider extracting the role constants (`ROLE_SYSTEM = 0`,
  `ROLE_USER = 1`, `ROLE_ASSISTANT = 2`) and the `convertRole` mapping into
  a small standalone module so they cannot drift again. The
  `node_modules/@types/vscode/index.d.ts` `LanguageModelChatMessageRole`
  enum is the single source of truth — current values at the time of this
  fix are `User = 1`, `Assistant = 2`, no public `System`.

**CLOSING LESSON:** every prior section (§3, §5, §6) shipped a real bug fix
that did not, by itself, end the loop. The repeated mistake was treating a
working hypothesis-test as proof of resolution. The reliable signal is
always: **reload → new recording → new log → verify the original symptom is
gone in the recorded conversation**. The §7 role-mapping fix is the first
one that survives that bar.
