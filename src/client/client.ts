/**
 * Anthropic streaming client wrapper.
 *
 * Creates an @anthropic-ai/sdk client configured for MiniMax's
 * Anthropic-compatible endpoint, streams messages, and maps events
 * to VS Code language-model parts (text + thinking stubs).
 */

import Anthropic from '@anthropic-ai/sdk'
import * as vscode from 'vscode'
import { resolveBaseUrl } from '../runtime/endpoint'
import { thinking as thinkingEnabled } from '../config'
import type { AnthropicMessageParam } from '../types'
import * as logger from '../logger'
import { showErrorToast } from './error'

/**
 * Stream a chat response from MiniMax.
 *
 * Reports `LanguageModelTextPart` (and in Phase 2 `LanguageModelThinkingPart`)
 * via the VS Code progress callback.
 */
export async function streamChat(
  apiKey: string,
  modelId: string,
  system: string | undefined,
  messages: readonly AnthropicMessageParam[],
  maxTokens: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  progress: vscode.Progress<any>,
  token: vscode.CancellationToken
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

  // Phase 2: wire adaptive thinking. For Phase 1 we send thinking only
  // for M3-family models when the toggle is on.
  const enableThinking =
    thinkingEnabled() && (modelId.includes('m3') || modelId.includes('M3'))
  if (enableThinking) {
    ;(params as unknown as Record<string, unknown>).thinking = {
      type: 'adaptive',
    }
  }

  logger.logRequest('POST', `${baseUrl}/v1/messages`, params)

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
        case 'content_block_delta': {
          const delta = event.delta

          if (delta.type === 'text_delta') {
            progress.report(new vscode.LanguageModelTextPart(delta.text))
          } else if (delta.type === 'thinking_delta') {
            // Phase 2: emit LanguageModelThinkingPart.
            // For now, when the proposed API is available, emit the thinking block.
            if (
              typeof (vscode as Record<string, unknown>)
                .LanguageModelThinkingPart === 'function'
            ) {
              progress.report(
                new vscode.LanguageModelTextPart(`[Thinking] ${delta.thinking}`)
              )
            }
          }
          break
        }
        case 'message_stop': {
          break
        }
        default:
          // content_block_start, message_delta, ping — no action needed
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
