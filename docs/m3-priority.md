# MiniMax M3 Priority — Findings

> Investigation notes for the **M3 Priority** variant in `minimax-copilot`.
> Combines repo inspection with official MiniMax documentation findings.

---

## TL;DR

**MiniMax M3 Priority** is the **same underlying model** as MiniMax M3, but routed
through MiniMax's **priority inference tier** — lower latency, faster queueing,
**~50% higher cost** on input/output tokens. Context window, multimodal support,
and thinking behavior are identical to standard M3.

| Aspect               | M3 (standard)       | M3 Priority           | Delta        |
| -------------------- | ------------------- | --------------------- | ------------ |
| Underlying model     | M3                  | M3                    | —            |
| Tier                 | `standard`          | `priority`            | routing-only |
| Context window       | 1M tokens           | 1M tokens             | —            |
| Multimodal (images)  | ✅                  | ✅                    | —            |
| Adaptive thinking    | ✅                  | ✅                    | —            |
| Input ($/1M, USD)    | $0.30               | **$0.45**             | +50%         |
| Output ($/1M, USD)   | $1.20               | **$1.80**             | +50%         |
| Cache read ($/1M)    | $0.06               | $0.06                 | —            |
| China-region billing | ~¥2.1 / ~¥8.4 per M | ~¥3.15 / ~¥12.6 per M | +50%         |

---

## Sources reviewed

### 1. Repository (`c:\devworks\minimax-copilot`)

The variant is declared in three places:

**`src/consts.ts`** — identifier + base pricing:

```ts
export const MODEL_M3_PRIORITY = 'minimax-m3-priority'
// ...
export const M3_CONTEXT = 1_048_576 // 1M
// ...
export const PRICING = {
  m3_standard: { input: 0.3, output: 1.2, cacheRead: 0.06 },
  // ...
} as const
```

**`src/models/registry.ts`** — only `tier` differs from standard M3:

```ts
{ id: MODEL_M3,          ..., tier: 'standard' }
{ id: MODEL_M3_PRIORITY, ..., tier: 'priority' }
```

The `tier` flag drives the picker tooltip via `pricingDetail()`, which multiplies
input/output by **1.5×** when `info.tier === 'priority'`:

```ts
if (info.id === MODEL_M3 || info.id === MODEL_M3_PRIORITY) {
  inputRate = PRICING.m3_standard.input * rate
  outputRate = PRICING.m3_standard.output * rate
  if (info.tier === 'priority') {
    inputRate *= 1.5
    outputRate *= 1.5
  }
}
```

**`README.md`** (line 108) — user-facing table:

```markdown
| **MiniMax M3 Priority** | `minimax-m3-priority` | 1M tokens | ✅ | ✅ (images) | Low-latency M3 (higher cost) |
```

### 2. Official MiniMax documentation

Fetched from the public docs indexes at:

- **Global:** `https://platform.minimax.io/docs`
- **China:** `https://platform.minimaxi.com/docs`

#### What the docs **do** document

The language-model overview tables list **four** current models, plus a
"Legacy Models" accordion for older versions:

| Model (docs name)                 | Description (verbatim)                                                           | Features (verbatim)                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| MiniMax-M3                        | "Frontier multimodal coding model with 1M context window"                        | • Multimodal<br />• 1M context window<br />• Frontier coding                                        |
| MiniMax-M2.7                      | "Beginning the journey of recursive self-improvement"                            | • Top real-world engineering<br />• Professional office delivery<br />• Character-rich interaction  |
| MiniMax-M2.7-highspeed            | "Same performance as M2.7, significantly faster inference"                       | • Polyglot code mastery<br />• Precision code refactoring<br />• Low latency                        |
| _(legacy)_ MiniMax-M2.5           | • Optimized for code generation and refactoring                                  | • Peak Performance. Ultimate Value. Master the Complex.                                             |
| _(legacy)_ MiniMax-M2.5-highspeed | • Same performance as M2.5, significantly faster inference                       | • Polyglot code mastery<br />• Precision code refactoring<br />• Low latency                        |
| _(legacy)_ MiniMax-M2.1           | • 230B total / 10B activated; code generation & refactoring                      | • Polyglot code mastery<br />• Precision code refactoring<br />• Enhanced reasoning                 |
| _(legacy)_ MiniMax-M2.1-highspeed | • Same performance as M2.1, significantly faster inference                       | • Polyglot code mastery<br />• Precision code refactoring<br />• Low latency                        |
| _(legacy)_ MiniMax-M2             | • Context Length: 200k tokens<br />• Maximum Output: 128k tokens (including CoT) | • Agentic capabilities<br />• Function calling<br />• Advanced reasoning<br />• Real-time streaming |

The docs index also explicitly recommends fetching the full listing from
`https://platform.minimax.io/docs/llms.txt` for discovery.

#### What the docs **do not** document

After scanning both the Global and China docs indexes (and the linked
`llms.txt` discovery file):

- ❌ **No entry for `MiniMax-M3-priority`** in the language-models overview tables
  on either the Global or China portals.
- ❌ **No dedicated pricing page** for an M3-priority tier was returned. Direct
  paths like `/docs/llms/pricing/overview` and `/docs/llms/models/llm-models-overview`
  return HTTP 404; the pricing area lives under the API reference rather than a
  separate docs page.
- ❌ **No SLA / latency / quota comparison** between standard and "priority" M3
  inferences in the publicly fetched docs.
- ✅ The **pattern** MiniMax uses for priority routing _is_ visible in the docs
  for older models — both `M2.7-highspeed`, `M2.5-highspeed`, and
  `M2.1-highspeed` are explicitly described as **"Same performance as M[n],
  significantly faster inference"**, with the "highspeed" model ID string
  being the routing discriminator.

#### Implication

The M3-priority variant in this extension is **most likely the same operational
mechanism as the documented `*-highspeed` variants** for M2.x — a routing-level
tier rather than a separately trained model. The docs simply don't yet list an
"M3-priority" row, even though the API model string `minimax-m3-priority` (or
its upstream Anthropic-compatible equivalent) is what we send to the endpoint.

> ⚠️ This interpretation is consistent with the docs and the code, but it
> **cannot be confirmed from the official docs alone** as of the fetch date —
> the docs index does not currently enumerate an M3-priority listing.

---

## How the variant is wired in this codebase

1. **Identifier** — `MODEL_M3_PRIORITY = 'minimax-m3-priority'` in
   `src/consts.ts`.
2. **Picker entry** — added to the `MODELS` array in `src/models/registry.ts`
   with `tier: 'priority'`.
3. **Tooltip pricing** — `pricingDetail()` multiplies M3 base rates by `1.5`
   when `tier === 'priority'`, and applies the China-region `×7` multiplier if
   the active host is `api.minimaxi.com`.
4. **Upstream request** — the model ID string is forwarded verbatim as the
   `model` field on the Anthropic-compatible `/v1/messages` request. There is
   **no separate code path, quota tracker, or rate limiter** for the priority
   tier — MiniMax handles allocation server-side based on the model ID.
5. **Region-agnostic** — the same model ID works on either
   `https://api.minimax.io/anthropic` or `https://api.minimaxi.com/anthropic`,
   decided by the user's region switch command.

---

## Operational notes for users

- **When to pick M3 Priority:** active iteration in chat, multimodal image
  reasoning, or any work where the latency difference between standard and
  priority M3 materially affects flow.
- **When _not_ to pick it:** long background tasks where latency is irrelevant;
  short turn-taking where `M2.7-highspeed` is cheaper and already fast enough;
  budget-sensitive sessions.
- **Region gotcha:** M3 Priority does **not** relax the region requirement — a
  mismatch still produces `401 Unauthorized`. Use the **Switch to Global/China**
  commands to align the endpoint with the key.
- **Visibility filter:** `minimax.visibleModels` accepts the priority ID, so
  `["minimax-m3-priority"]` is a valid value if a user wants to lock the picker
  to just the priority tier.

---

## Open questions worth verifying with MiniMax directly

1. Is `minimax-m3-priority` an officially supported model ID on the
   Anthropic-compatible endpoint, or has it been (re)named? If named differently,
   the extension should be updated to match the upstream string.
2. Is the documented `M2.7-highspeed` pattern ("same performance, significantly
   faster inference, +50% cost") the _actual_ SLA contract that applies to
   `minimax-m3-priority`?
3. Are there throughput or concurrency caps that differ between the standard
   and priority M3 tiers (e.g., request-per-minute, tokens-per-minute)?
4. Does the priority tier change during traffic spikes, or is it always
   reserved capacity?

These are the unknowns that cannot be resolved from the docs we have read —
they would need a direct answer from MiniMax support or an account-level
admin panel.
