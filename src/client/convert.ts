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
  const messages: AnthropicMessageParam[] = []

  for (const msg of vscodeMessages) {
    const role: number = msg.role

    // LanguageModelChatMessageRole: 1 = system, 2 = user, 3 = assistant
    if (role === 1) {
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
    if (blocks.length > 0 && (role === 2 || role === 3)) {
      messages.push({
        role: role === 2 ? 'user' : 'assistant',
        content: blocks,
      } as unknown as AnthropicMessageParam)
    }
  }

  return { system, messages }
}

/**
 * Build an array of Anthropic content blocks from VS Code parts.
 *
 * Assistant messages may contain `LanguageModelThinkingPart` blocks
 * that need to be replayed as Anthropic `thinking` content blocks
 * (with their `signature`). User messages are always `text` blocks.
 */
function buildAnthropicContentBlocks(
  content: readonly unknown[],
  _role: number,
  thinkingSignatures?: ReadonlyMap<string, string>
): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = []

  for (const part of content) {
    if (isThinkingPart(part)) {
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
    } else {
      // Text part (user or assistant).
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
