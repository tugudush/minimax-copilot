/**
 * MiniMax Chat Provider — the LanguageModelChatProvider implementation.
 *
 * Registered once at activation. Copilot Chat calls this to:
 *  1. List models in the picker.
 *  2. Stream a chat response.
 *  3. Estimate token counts.
 *
 * ## Thinking (Phase 2)
 *
 * The provider maintains a `thinkingSignatures` map keyed by stable
 * thinking block ids. The streaming client populates it with
 * signatures as thinking blocks complete; `convertMessages` reads it
 * to replay signed thinking blocks in subsequent turns.
 */

import * as vscode from 'vscode'
import { getApiKey, onDidChangeApiKey } from '../auth'
import { buildChatInformation } from './models'
import { findModel } from '../models/registry'
import { maxOutputTokens } from '../config'
import {
  convertMessages,
  convertTools,
  extractToolResultText,
} from '../client/convert'
import { streamChat } from '../client/client'
import * as logger from '../logger'
import { t } from '../i18n'

export class MiniMaxChatProvider implements vscode.LanguageModelChatProvider {
  private _onDidChange = new vscode.EventEmitter<void>()
  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void> =
    this._onDidChange.event

  /**
   * Monotonic counter incremented each chat turn. Used to build
   * stable thinking block ids (`minimax-thinking-<turn>-<block>`).
   */
  private turnIndex = 0

  /**
   * Map of thinking block id → signature, populated by the streaming
   * client and consumed by `convertMessages` for replay.
   */
  private thinkingSignatures = new Map<string, string>()

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      onDidChangeApiKey(() => {
        this._onDidChange.fire()
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('minimax.visibleModels') ||
          e.affectsConfiguration('minimax.apiBaseUrl')
        ) {
          this._onDidChange.fire()
        }
      })
    )
  }

  /* ---- Model listing ---- */

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    return buildChatInformation(this.context)
  }

  /* ---- Token counting (rough estimate) ---- */

  provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    const str = typeof text === 'string' ? text : JSON.stringify(text)
    return Promise.resolve(Math.ceil(str.length / 3.5))
  }

  /* ---- Chat streaming ---- */

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progress: vscode.Progress<any>,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Check for API key.
    const apiKey = await getApiKey(this.context)
    if (!apiKey) {
      progress.report(new vscode.LanguageModelTextPart(t('auth.noKey')))
      return
    }

    // Validate model.
    const info = findModel(model.id)
    if (!info) {
      progress.report(
        new vscode.LanguageModelTextPart(`Unknown model: ${model.id}`)
      )
      return
    }

    logger.info(
      `Chat request: model=${model.id}, messages=${messages.length}, toolMode=${options.toolMode}, tools=${options.tools?.length ?? 0}`
    )

    // Diagnostic: log the shape of every tool-result content part so we can
    // root-cause tool-call loops (e.g. tool_result content collapsing to
    // "(empty)" because parts aren't LanguageModelTextPart). Safe to remove
    // once the loop bug is confirmed fixed.
    try {
      for (const m of messages) {
        const parts = (m as { content?: unknown }).content
        if (!Array.isArray(parts)) continue
        for (const part of parts) {
          const p = part as {
            callId?: string
            name?: unknown
            content?: unknown
          }
          if (typeof p.callId !== 'string') continue
          // A tool CALL part has `name`; a tool RESULT part does not.
          if (typeof p.name === 'string') continue
          const raw = p.content
          let arr: unknown[]
          if (Array.isArray(raw)) {
            arr = raw
          } else if (raw && typeof raw === 'object' && 'content' in raw) {
            const inner = (raw as { content?: unknown }).content
            arr = Array.isArray(inner) ? inner : []
          } else {
            arr = []
          }
          const extracted = extractToolResultText(raw)
          for (let i = 0; i < arr.length; i++) {
            const c: unknown = arr[i]
            let label: string
            if (c === null || c === undefined) {
              label = 'null'
            } else if (typeof c !== 'object') {
              label = typeof c
            } else {
              const obj = c as Record<string, unknown>
              const keys = Object.keys(obj).slice(0, 10).join(',')
              if ('value' in obj && typeof obj.value === 'string') {
                label = `TextPart(${keys})`
              } else if ('data' in obj && 'mimeType' in obj) {
                label = `DataPart(${keys})`
              } else if ('value' in obj) {
                label = `PromptTsxPart(${keys})`
              } else {
                label = `Object(${keys})`
              }
            }
            let snippet = ''
            try {
              const s = JSON.stringify(c)
              snippet = typeof s === 'string' ? s.slice(0, 300) : ''
            } catch {
              snippet = '[unserializable]'
            }
            logger.info(
              `[toolresult-diag] callId=${p.callId} part[${i}] ${label} snippet=${snippet}`
            )
          }
          logger.info(
            `[toolresult-diag] callId=${p.callId} extractedLen=${extracted.length} extracted=${extracted.slice(0, 300)}`
          )
        }
      }
    } catch {
      // Diagnostics must never break the request.
    }

    // Advance the turn counter for stable thinking block ids.
    const turn = this.turnIndex++

    // Convert messages, replaying prior thinking blocks with their
    // signatures so the model sees its own past reasoning.
    const { system, messages: anthropicMessages } = convertMessages(
      messages,
      this.thinkingSignatures
    )

    // Determine max tokens.
    const configMax = maxOutputTokens()
    const maxTokens = configMax > 0 ? configMax : 4096

    // Convert tools (if any) so the model can call them via the API
    // instead of hallucinating tool-call markup as text.
    const tools = convertTools(options.tools)

    // Stream. The client will populate `this.thinkingSignatures` with
    // any new thinking-block signatures returned by the server.
    await streamChat(
      apiKey,
      model.id,
      system,
      anthropicMessages,
      maxTokens,
      progress,
      token,
      this.thinkingSignatures,
      turn,
      tools,
      options.toolMode
    )
  }

  /* ---- Cleanup ---- */

  dispose(): void {
    this._onDidChange.dispose()
  }
}
