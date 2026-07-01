/**
 * Convert VS Code chat messages to Anthropic-compatible format.
 *
 * Handles:
 *  - System-message extraction (Anthropic takes system as a top-level param).
 *  - Text content unwrapping (VS Code wraps text in LanguageModelTextPart).
 *  - Thinking-block replay with signatures (Phase 2 — stubbed for now).
 */

import type * as vscode from 'vscode'
import type { AnthropicMessageParam } from '../types'

/**
 * Convert a VS Code message list to Anthropic params.
 *
 * Returns `{ system, messages }`. System messages are extracted from
 * the array and returned separately (Anthropic wants system as a
 * top-level `system` field, not as a message in the array).
 */
export function convertMessages(
  vscodeMessages: readonly vscode.LanguageModelChatRequestMessage[]
): {
  system: string | undefined
  messages: AnthropicMessageParam[]
} {
  let system: string | undefined
  const messages: AnthropicMessageParam[] = []

  for (const msg of vscodeMessages) {
    const role: number = msg.role
    const content = normalizeContent(msg.content)

    // LanguageModelChatMessageRole: 1 = system, 2 = user, 3 = assistant
    if (role === 1) {
      if (content) {
        system = system ? `${system}\n${content}` : content
      }
      continue
    }

    // Only emit user/assistant messages that have content.
    if (content && (role === 2 || role === 3)) {
      messages.push({
        role: role === 2 ? 'user' : 'assistant',
        content: [{ type: 'text', text: content }],
      })
    }
  }

  return { system, messages }
}

/**
 * Normalize VS Code message content to a plain string.
 *
 * VS Code sends content as an array of parts (LanguageModelTextPart, etc.).
 */
function normalizeContent(content: readonly unknown[]): string {
  const texts: string[] = []

  for (const part of content) {
    // LanguageModelTextPart has a `value` property containing the text.
    const textPart = part as vscode.LanguageModelTextPart
    if (typeof textPart.value === 'string') {
      texts.push(textPart.value)
    }
  }

  return texts.filter(Boolean).join('\n')
}
