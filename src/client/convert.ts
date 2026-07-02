/**
 * Convert VS Code chat messages to Anthropic-compatible format.
 *
 * Handles:
 *  - System-message extraction (Anthropic takes system as a top-level param).
 *  - Text content unwrapping (VS Code wraps text in LanguageModelTextPart).
 *  - Thinking-block replay with signatures (Phase 2).
 *
 * ## Thinking replay
 *
 * When Copilot Chat sends back a prior assistant turn that contains
 * `LanguageModelThinkingPart` blocks, this module reconstructs them as
 * Anthropic `thinking` content blocks — including the `signature`
 * (required by the API for signed thinking history). Signatures are
 * looked up from the `thinkingSignatures` map populated by the
 * streaming client on the previous turn.
 */

import type * as vscode from 'vscode'
import { THINKING_ID_PREFIX } from '../consts'
import { getThinkingPartCtor } from '../runtime/thinkingPartGuard'
import type { AnthropicMessageParam } from '../types'

const ROLE_SYSTEM = 0
const ROLE_USER = 1
const ROLE_ASSISTANT = 2

/* ---- Proposed-API guard ---- */
// Lazy-resolved via getThinkingPartCtor() from ../runtime/thinkingPartGuard.

/**
 * Convert a VS Code message list to Anthropic params.
 *
 * @param thinkingSignatures  Map of thinking block id → signature,
 *   populated by the streaming client on prior turns. Used to
 *   replay signed thinking blocks in history.
 *
 * @returns `{ system, messages }`. System messages are extracted from
 *   the array and returned separately (Anthropic wants system as a
 *   top-level `system` field, not as a message in the array).
 */
export function convertMessages(
  vscodeMessages: readonly vscode.LanguageModelChatRequestMessage[],
  thinkingSignatures?: ReadonlyMap<string, string>
): {
  system: string | undefined
  messages: AnthropicMessageParam[]
} {
  let system: string | undefined
  // Internal type with a mutable content array so we can merge adjacent
  // same-role messages (Anthropic requires strictly alternating roles).
  const messages: {
    role: string
    content: Record<string, unknown>[]
  }[] = []

  for (const msg of vscodeMessages) {
    const role: number = msg.role

    // VS Code LanguageModelChatMessageRole: User = 1, Assistant = 2.
    // Role 0 is kept as a defensive system-message escape hatch for
    // provider/runtime variants that may pass one through.
    if (role === ROLE_SYSTEM) {
      const text = normalizeContent(msg.content)
      if (text) {
        system = system ? `${system}\n${text}` : text
      }
      continue
    }

    // Build the Anthropic content-block array for this message.
    const blocks = buildAnthropicContentBlocks(
      msg.content,
      role,
      thinkingSignatures
    )

    // Only emit messages that have content.
    if (blocks.length > 0 && (role === ROLE_USER || role === ROLE_ASSISTANT)) {
      const anthropicRole = role === ROLE_USER ? 'user' : 'assistant'
      const last = messages[messages.length - 1]
      if (last?.role === anthropicRole) {
        // Anthropic requires alternating user/assistant roles; merge
        // adjacent same-role messages (e.g. multiple tool results).
        last.content.push(...blocks)
      } else {
        messages.push({ role: anthropicRole, content: blocks })
      }
    }
  }

  return {
    system,
    messages: messages as unknown as AnthropicMessageParam[],
  }
}

/**
 * Build an array of Anthropic content blocks from VS Code parts.
 *
 * Assistant messages may contain `LanguageModelThinkingPart` blocks
 * that need to be replayed as Anthropic `thinking` content blocks
 * (with their `signature`). User messages are `text` and/or `image`
 * blocks — attached images arrive as `LanguageModelDataPart` and are
 * emitted as Anthropic `image` content blocks (see docs/bugs/vision.md).
 */
function buildAnthropicContentBlocks(
  content: readonly unknown[],
  _role: number,
  thinkingSignatures?: ReadonlyMap<string, string>
): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = []

  for (const part of content) {
    if (isToolCallPart(part)) {
      // Assistant tool call → Anthropic tool_use block.
      const p = part as { callId: string; name: string; input?: object }
      blocks.push({
        type: 'tool_use',
        id: p.callId,
        name: p.name,
        input: p.input ?? {},
      })
    } else if (isToolResultPart(part)) {
      // User tool result → Anthropic tool_result block.
      const p = part as { callId: string; content: unknown }
      blocks.push({
        type: 'tool_result',
        tool_use_id: p.callId,
        content: extractToolResultText(p.content),
      })
    } else if (isThinkingPart(part)) {
      // Reconstruct Anthropic thinking block with signature (if available).
      const thinkingText = getPartValue(part)
      const partId = getPartId(part)
      const signature = (partId && thinkingSignatures?.get(partId)) ?? undefined

      if (thinkingText) {
        blocks.push({
          type: 'thinking',
          thinking: thinkingText,
          signature: signature ?? '',
        })
      }
    } else if (isImageDataPart(part)) {
      // User-attached image (LanguageModelDataPart with an image/* mime).
      // VS Code delivers attached images as { data: Uint8Array, mimeType };
      // emit an Anthropic `image` block with a base64 source so M3 can see
      // it. Without this branch the image would fall into the text fallback
      // where `getPartValue` returns '' (data parts have no `.value`) and
      // be silently dropped. See docs/bugs/vision.md.
      const p = part as { data: Uint8Array | ArrayBufferLike; mimeType: string }
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: p.mimeType,
          data: toBase64(p.data),
        },
      })
    } else {
      // Text part (user or assistant), or a non-image data part we can't
      // represent in the Anthropic Messages API (e.g. video/*, audio/*, or
      // the synthetic `cache_control` marker). Non-image data parts have no
      // `.value`, so `getPartValue` returns '' and they are dropped here.
      const text = getPartValue(part)
      if (text) {
        blocks.push({ type: 'text', text })
      }
    }
  }

  // If no thinking blocks were found but we have text blocks, that's fine.
  // If the array is empty, the caller will skip this message.
  return blocks
}

/* ---- Helpers ---- */

/**
 * Normalize VS Code message content to a plain string.
 *
 * Used for system messages only; for user/assistant we use
 * `buildAnthropicContentBlocks` to preserve thinking structure.
 */
function normalizeContent(content: readonly unknown[]): string {
  const texts: string[] = []

  for (const part of content) {
    const text = getPartValue(part)
    if (text) {
      texts.push(text)
    }
  }

  return texts.filter(Boolean).join('\n')
}

/** Extract the text value from a VS Code part. */
function getPartValue(part: unknown): string {
  if (typeof part === 'string') return part
  const p = part as { value?: string | string[] }
  if (Array.isArray(p.value)) return p.value.join('')
  if (typeof p.value === 'string') return p.value
  return ''
}

/** Extract the id from a part (thinking parts have stable ids). */
function getPartId(part: unknown): string | undefined {
  const p = part as { id?: string }
  return typeof p.id === 'string' ? p.id : undefined
}

/** Duck-type check: is this part a LanguageModelThinkingPart? */
function isThinkingPart(part: unknown): boolean {
  // Preferred: instanceof check when the proposal is active.
  const Ctor = getThinkingPartCtor()
  if (Ctor && part instanceof Ctor) {
    return true
  }

  // Fallback: duck-type by id prefix (our thinking blocks always have
  // an id matching `minimax-thinking-*`).
  const p = part as { id?: string }
  if (typeof p.id === 'string' && p.id.startsWith(THINKING_ID_PREFIX)) {
    return true
  }

  return false
}

/** Duck-type check: is this part a LanguageModelToolCallPart? */
function isToolCallPart(part: unknown): boolean {
  const p = part as { callId?: string; name?: string; input?: unknown }
  return typeof p.callId === 'string' && typeof p.name === 'string'
}

/** Duck-type check: is this part a LanguageModelToolResultPart? */
function isToolResultPart(part: unknown): boolean {
  const p = part as { callId?: string; content?: unknown }
  return (
    typeof p.callId === 'string' &&
    p.content !== undefined &&
    p.content !== null
  )
}

/** Duck-type check: is this part a LanguageModelDataPart carrying an image?
 *
 * VS Code delivers attached images as `LanguageModelDataPart` blocks with
 * shape `{ data: Uint8Array, mimeType: 'image/png' | 'image/jpeg' | ... }`.
 * Without an explicit image branch these would fall into the text fallback,
 * where `getPartValue` returns '' (data parts have no `.value`) and the
 * image is silently dropped before reaching MiniMax. See docs/bugs/vision.md.
 *
 * Accepts both `Uint8Array` and any `ArrayBuffer`-like (`byteLength` present)
 * so we tolerate the various typed-array shapes VS Code may hand us.
 */
function isImageDataPart(part: unknown): boolean {
  const p = part as { data?: unknown; mimeType?: string }
  return (
    typeof p.mimeType === 'string' &&
    p.mimeType.startsWith('image/') &&
    (p.data instanceof Uint8Array ||
      (p.data != null && typeof p.data === 'object' && 'byteLength' in p.data))
  )
}

/** Base64-encode image bytes for the Anthropic `image` block source.
 *
 * Uses Node's `Buffer` (available in the extension host) so we don't pull in
 * a base64 dependency. Normalizes `ArrayBuffer`-like input to `Uint8Array`
 * first, mirroring `extractPartText`'s data-part handling. */
function toBase64(data: Uint8Array | ArrayBufferLike): string {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
  return Buffer.from(u8).toString('base64')
}

/** Extract text from a tool result's content array.
 *
 * A `LanguageModelToolResultPart.content` array can hold any of:
 *  - `LanguageModelTextPart`     → `{ value: string }`
 *  - `LanguageModelPromptTsxPart`→ `{ value: <rendered tree> }`
 *  - `LanguageModelDataPart`     → `{ data: Uint8Array, mimeType: string }`
 *  - arbitrary `unknown` objects
 *
 * Previously this only read `.value` (via `getPartValue`), so any non-text
 * part resolved to '' and the whole result collapsed to `'(empty)'`. The
 * model then saw an empty tool_result, assumed it had no output, and loops
 * re-proposing the same tool (e.g. `git status`) forever.
 */
export function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content === undefined || content === null) return ''

  // Defensive unwrap: some wrappers nest the array under `.content`.
  let actualContent = content
  if (
    typeof content === 'object' &&
    !Array.isArray(content) &&
    'content' in content
  ) {
    const innerContent = (content as Record<string, unknown>).content
    if (Array.isArray(innerContent)) {
      actualContent = innerContent
    }
  }

  if (!Array.isArray(actualContent)) {
    return safeStringify(actualContent)
  }

  const texts: string[] = []
  for (const part of actualContent) {
    const text = extractPartText(part)
    if (text) texts.push(text)
  }
  return texts.join('\n') || '(empty)'
}

/** Extract a best-effort text representation from a single tool-result
 * content part, handling all documented VS Code part types so we never
 * silently drop a result to an empty string. */
function extractPartText(part: unknown): string {
  if (part == null) return ''
  if (typeof part === 'string') return part
  if (typeof part === 'number' || typeof part === 'bigint') {
    return String(part)
  }
  if (typeof part === 'boolean') return part ? 'true' : 'false'
  if (typeof part === 'symbol') return part.description ?? ''

  const p = part as {
    value?: unknown
    data?: unknown
    mimeType?: string
  }

  // LanguageModelTextPart (and thinking-style): { value: string }
  if (typeof p.value === 'string') return p.value
  if (Array.isArray(p.value)) {
    return p.value
      .map((x) => (typeof x === 'string' ? x : safeStringify(x)))
      .join('')
  }

  // LanguageModelDataPart: { data: Uint8Array, mimeType: string }
  const d = p.data
  if (
    d instanceof Uint8Array ||
    (d && typeof d === 'object' && 'byteLength' in d)
  ) {
    const mime = typeof p.mimeType === 'string' ? p.mimeType : ''

    // Copilot Chat attaches a synthetic `mimeType: 'cache_control'` data
    // part to some tool-result content arrays as an internal prompt-cache
    // breakpoint hint — it is NOT real tool output. Previously this fell
    // through to the binary branch below and got serialized as literal
    // "[binary cache_control]" text appended to the actual result, which
    // pollutes what the model reads back (e.g. a branch name followed by
    // garbage). Drop it silently instead.
    if (mime === 'cache_control') {
      return ''
    }

    const u8 =
      d instanceof Uint8Array ? d : new Uint8Array(d as ArrayBufferLike)
    const isText =
      !mime ||
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      mime.startsWith('application/xml') ||
      mime.startsWith('application/javascript')
    if (isText) {
      try {
        return new TextDecoder('utf-8').decode(u8)
      } catch {
        return ''
      }
    }
    return `[binary ${mime || 'data'}]`
  }

  // LanguageModelPromptTsxPart ({ value: <rendered tree> }) and any other
  // non-text/non-data part: serialize the whole part so its content is
  // preserved (never silently dropped to '') for the model to read.
  return safeStringify(part)
}

/** JSON.stringify that never throws. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

/**
 * Convert VS Code tool definitions to Anthropic-compatible format.
 *
 * Returns `undefined` when there are no tools, so the caller can omit
 * the `tools` param entirely (some endpoints reject an empty array).
 */
export function convertTools(
  tools: readonly vscode.LanguageModelChatTool[] | undefined
): { name: string; description: string; input_schema: object }[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema ?? { type: 'object', properties: {} },
  }))
}
