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
import { maxOutputTokens, pathImageInline, pathImageMaxBytes } from '../config'
import { convertMessages, convertTools } from '../client/convert'
import { inlinePathImages } from '../runtime/pathImageResolver'
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

    // Advance the turn counter for stable thinking block ids.
    const turn = this.turnIndex++

    // Inline any image paths in user-message text (`docs/foo.png`, `C:\...`,
    // `#file:...`) as `LanguageModelDataPart` blocks. After this, the
    // message contents are a mix of text and image data parts — exactly
    // what `convert.ts`'s image branch (vision.md §6) turns into
    // Anthropic `image` content blocks.
    const prepared = await inlinePathImages(messages, {
      enabled: pathImageInline(),
      maxBytes: pathImageMaxBytes(),
    })
    if (prepared !== messages) {
      logger.info(
        `Chat request: prepared=${prepared.length} msgs (path-image inline active)`
      )
    }

    // Convert messages, replaying prior thinking blocks with their
    // signatures so the model sees its own past reasoning.
    const { system, messages: anthropicMessages } = convertMessages(
      prepared,
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
