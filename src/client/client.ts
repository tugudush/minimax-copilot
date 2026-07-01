/**
 * Anthropic streaming client wrapper.
 *
 * Creates an @anthropic-ai/sdk client configured for MiniMax's
 * Anthropic-compatible endpoint, streams messages, and maps events
 * to VS Code language-model parts (text + thinking).
 *
 * ## Thinking handling (Phase 2)
 *
 * M3-family models receive `thinking: { type: "adaptive" }`. Streaming
 * `thinking_delta` events map to `LanguageModelThinkingPart` with a
 * stable `id` so Copilot Chat renders its collapsible "Thinking" block.
 *
 * Thinking-block `signature` values (required by Anthropic for replay)
 * are captured from `content_block_stop` events and stored in the
 * supplied `thinkingSignatures` map keyed by block `id`.
 *
 * When the `languageModelThinkingPart` proposal is unavailable,
 * thinking content is dropped silently — chat still works.
 */

import Anthropic from '@anthropic-ai/sdk'
import * as vscode from 'vscode'
import { resolveBaseUrl } from '../runtime/endpoint'
import { thinking as thinkingEnabled } from '../config'
import { THINKING_ID_PREFIX } from '../consts'
import { getThinkingPartCtor } from '../runtime/thinkingPartGuard'
import type { AnthropicMessageParam } from '../types'
import * as logger from '../logger'
import { showErrorToast } from './error'

/**
 * Stream a chat response from MiniMax.
 *
 * @param thinkingSignatures  Populated in-place: block id → signature
 *   for every thinking block the server returns. Consumed by
 *   `convert.ts` when replaying thinking history on the next turn.
 * @param turnIndex  Monotonic per-chat-turn counter; used to build
 *   stable thinking block ids.
 */
export async function streamChat(
  apiKey: string,
  modelId: string,
  system: string | undefined,
  messages: readonly AnthropicMessageParam[],
  maxTokens: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  progress: vscode.Progress<any>,
  token: vscode.CancellationToken,
  thinkingSignatures?: Map<string, string>,
  turnIndex?: number,
  tools?: { name: string; description: string; input_schema: object }[],
  toolMode?: number
): Promise<void> {
  const baseUrl = resolveBaseUrl()

  const client = new Anthropic({
    apiKey,
    baseURL: baseUrl,
  })

  // Build request params
  const params: Anthropic.MessageCreateParams = {
    model: modelId,
    max_tokens: maxTokens || 4096,
    messages: messages as Anthropic.MessageCreateParams['messages'],
  }

  if (system) {
    params.system = system
  }

  // Phase 2: wire adaptive thinking for M3-family models.
  const enableThinking =
    thinkingEnabled() && (modelId.includes('m3') || modelId.includes('M3'))
  if (enableThinking) {
    ;(params as unknown as Record<string, unknown>).thinking = {
      type: 'adaptive',
    }
  }

  // Tools: pass through to the API so the model can call them via
  // tool_use content blocks instead of hallucinating tool-call text.
  if (tools && tools.length > 0) {
    ;(params as unknown as Record<string, unknown>).tools = tools
    // toolMode 2 = Required → force a tool call.
    if (toolMode === 2) {
      ;(params as unknown as Record<string, unknown>).tool_choice = {
        type: 'any',
      }
      logger.info(
        '[stream-diag] tool_choice forced to "any" (toolMode=Required)'
      )
    }
  }

  logger.logRequest('POST', `${baseUrl}/v1/messages`, params)

  // Per-stream state: track in-flight thinking blocks so we can
  // capture signatures when the block completes.
  let thinkingBlockIdx = 0

  // Track in-flight tool_use blocks by content-block index so we can
  // accumulate input_json_delta fragments and emit a
  // LanguageModelToolCallPart when the block completes.
  const toolBlocks = new Map<
    number,
    { id: string; name: string; input: string }
  >()

  try {
    const stream = await client.messages.create({
      ...params,
      stream: true,
    })

    for await (const event of stream) {
      if (token.isCancellationRequested) {
        break
      }

      switch (event.type) {
        case 'content_block_start': {
          // Track when a thinking block begins (resets the delta accumulator).
          if (event.content_block.type === 'thinking') {
            // no-op — the block index is already known; we just note
            // that the next thinking_delta belongs to this block.
          } else if (event.content_block.type === 'tool_use') {
            const cb = event.content_block as unknown as {
              id?: string
              name?: string
            }
            toolBlocks.set(event.index, {
              id: cb.id ?? `toolu_${event.index}_${Date.now()}`,
              name: cb.name ?? '',
              input: '',
            })
          }
          break
        }

        case 'content_block_delta': {
          const delta = event.delta

          if (delta.type === 'text_delta') {
            progress.report(new vscode.LanguageModelTextPart(delta.text))
          } else if (delta.type === 'thinking_delta') {
            // Emit LanguageModelThinkingPart when the proposal is active.
            const Ctor = getThinkingPartCtor()
            if (Ctor) {
              const blockId = `${THINKING_ID_PREFIX}-${turnIndex ?? 0}-${thinkingBlockIdx}`
              progress.report(new Ctor(delta.thinking, blockId))
            }
            // When the proposal is unavailable, drop silently — chat
            // still works, just without the reasoning block.
          } else if (delta.type === 'input_json_delta') {
            // Accumulate tool-use input fragments.
            const d = delta as unknown as { partial_json?: string }
            const block = toolBlocks.get(event.index)
            if (block) {
              block.input += d.partial_json ?? ''
            }
          }
          break
        }

        case 'content_block_stop': {
          const idx = event.index

          // Capture the completed thinking block's signature.
          // The SDK's RawContentBlockStopEvent only exposes {type, index}
          // at the type level, but the runtime object carries content_block.
          const raw = event as unknown as {
            content_block?: { type?: string; signature?: string }
          }
          const cb = raw.content_block
          if (thinkingSignatures && cb?.type === 'thinking') {
            const blockId = `${THINKING_ID_PREFIX}-${turnIndex ?? 0}-${thinkingBlockIdx}`
            if (cb.signature) {
              thinkingSignatures.set(blockId, cb.signature)
            }
            thinkingBlockIdx++
          }

          // Emit a LanguageModelToolCallPart for completed tool_use blocks.
          const toolBlock = toolBlocks.get(idx)
          if (toolBlock) {
            let input: object = {}
            if (toolBlock.input) {
              try {
                input = JSON.parse(toolBlock.input) as object
              } catch {
                // Keep empty object on parse error.
              }
            }
            progress.report(
              new vscode.LanguageModelToolCallPart(
                toolBlock.id,
                toolBlock.name,
                input
              )
            )
            toolBlocks.delete(idx)
          }
          break
        }

        case 'message_delta': {
          const stopReason = (
            event as unknown as { delta?: { stop_reason?: string } }
          ).delta?.stop_reason
          if (stopReason) {
            logger.info(`[stream-diag] stop_reason=${stopReason}`)
          }
          break
        }

        case 'message_stop': {
          break
        }

        default:
          // message_start, ping — no action needed
          break
      }
    }
  } catch (err: unknown) {
    if (token.isCancellationRequested) {
      return
    }

    const status = (err as { status?: number }).status
    if (status) {
      showErrorToast(status)
    } else if (err instanceof Error) {
      showErrorToast(err.message)
    } else {
      showErrorToast(String(err))
    }
    throw err
  }
}
