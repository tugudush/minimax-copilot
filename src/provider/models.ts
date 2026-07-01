/**
 * Build model-picker entries from the registry.
 *
 * Filters by `minimax.visibleModels` and enriches with pricing
 * tooltips for the active region.
 */

import * as vscode from 'vscode';
import { MODELS, pricingDetail } from '../models/registry';
import { visibleModels } from '../config';
import { hasApiKey } from '../auth';
import { t } from '../i18n';

/**
 * Build the list of `LanguageModelChatInformation` entries to show
 * in the Copilot Chat model picker.
 */
export async function buildChatInformation(
  context: vscode.ExtensionContext,
): Promise<vscode.LanguageModelChatInformation[]> {
  const visible = visibleModels();
  const hasKey = await hasApiKey(context);

  let models = MODELS;

  // Filter to user-requested models if the list is non-empty.
  if (visible.length > 0) {
    models = models.filter((m) => visible.includes(m.id));
  }

  return models.map((info) => {
    const detail = pricingDetail(info);
    const tooltip = hasKey ? `PAYG • ${detail}` : t('provider.noKey');

    // LanguageModelChatInformation is an interface — return a plain
    // object conforming to it.
    return {
      id: info.id,
      name: info.name,
      family: info.id.includes('m3') ? 'm3' : 'm2.7',
      version: '1.0',
      maxInputTokens: info.contextWindow,
      maxOutputTokens: 8192,
      tooltip,
      detail: hasKey ? `PAYG • ${detail}` : undefined,
      capabilities: {
        imageInput: info.multimodal,
        toolCalling: 128,
      },
    } satisfies vscode.LanguageModelChatInformation;
  });
}
