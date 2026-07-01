/**
 * MiniMax Chat Provider — the LanguageModelChatProvider implementation.
 *
 * Registered once at activation. Copilot Chat calls this to:
 *  1. List models in the picker.
 *  2. Stream a chat response.
 *  3. Estimate token counts.
 */

import * as vscode from 'vscode'
import { getApiKey, onDidChangeApiKey } from '../auth'
import { buildChatInformation } from './models'
import { findModel } from '../models/registry'
import { maxOutputTokens } from '../config'
import { convertMessages } from '../client/convert'
import { streamChat } from '../client/client'
import * as logger from '../logger'
import { t } from '../i18n'

export class MiniMaxChatProvider implements vscode.LanguageModelChatProvider {
  private _onDidChange = new vscode.EventEmitter<void>()
  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void> =
    this._onDidChange.event

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
    _options: vscode.ProvideLanguageModelChatResponseOptions,
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

    logger.info(`Chat request: model=${model.id}, messages=${messages.length}`)

    // Convert messages.
    const { system, messages: anthropicMessages } = convertMessages(messages)

    // Determine max tokens.
    const configMax = maxOutputTokens()
    const maxTokens = configMax > 0 ? configMax : 4096

    // Stream.
    await streamChat(
      apiKey,
      model.id,
      system,
      anthropicMessages,
      maxTokens,
      progress,
      token
    )
  }

  /* ---- Cleanup ---- */

  dispose(): void {
    this._onDidChange.dispose()
  }
}
