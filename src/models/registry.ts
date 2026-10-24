/**
 * Model registry — MiniMax M3.1 Flash / M3 definitions.
 *
 * Defines the supported models with context windows, thinking support,
 * pricing tiers, and multimodal capability. The chat provider reads
 * this to build picker entries.
 *
 * Only the M3 family is supported. The M2.x models were dropped:
 * MiniMax retired M2.5/M2.7 on 2026-11-18, and the Anthropic-
 * compatible endpoint now only serves M3.1 Flash and M3.
 *
 * This module is deliberately free of `vscode` imports so it can be
 * unit-tested in plain Node. Display names are resolved lazily via
 * `modelName()` — resolving them at module load would freeze the
 * locale before `initI18n()` has run.
 */

import {
  MODEL_M3_1_FLASH,
  MODEL_M3,
  MODEL_M3_PRIORITY,
  M3_1_FLASH_CONTEXT,
  M3_1_FLASH_MAX_OUTPUT,
  M3_CONTEXT,
  M3_MAX_OUTPUT,
  PRICING,
} from '../consts'
import type { ModelInfo } from '../types'
import { t } from '../i18n'

/* ---- Model definitions ---- */

export const MODELS: ModelInfo[] = [
  {
    id: MODEL_M3_1_FLASH,
    contextWindow: M3_1_FLASH_CONTEXT,
    thinking: true,
    tier: 'standard',
    multimodal: true,
    family: 'm3.1',
    outputCap: M3_1_FLASH_MAX_OUTPUT,
    // M3.1 Flash always thinks — the API rejects `thinking: disabled`.
    thinkingAlwaysOn: true,
    effortTunable: true,
    pricingKey: 'm3_1_flash',
  },
  {
    id: MODEL_M3,
    contextWindow: M3_CONTEXT,
    thinking: true,
    tier: 'standard',
    multimodal: true,
    family: 'm3',
    outputCap: M3_MAX_OUTPUT,
    thinkingAlwaysOn: false,
    effortTunable: false,
    pricingKey: 'm3_standard',
  },
  {
    id: MODEL_M3_PRIORITY,
    contextWindow: M3_CONTEXT,
    thinking: true,
    tier: 'priority',
    multimodal: true,
    family: 'm3',
    outputCap: M3_MAX_OUTPUT,
    thinkingAlwaysOn: false,
    effortTunable: false,
    pricingKey: 'm3_standard',
  },
]

/* ---- Display names ---- */

/** i18n key for a model's display name. */
const NAME_KEYS: Record<string, string> = {
  [MODEL_M3_1_FLASH]: 'model.m3.1-flash.name',
  [MODEL_M3]: 'model.m3.name',
  [MODEL_M3_PRIORITY]: 'model.m3-priority.name',
}

/**
 * Resolve a model's localized display name.
 *
 * Kept out of the `MODELS` table so the locale is read at call time
 * rather than at module-load time.
 */
export function modelName(info: ModelInfo): string {
  const key = NAME_KEYS[info.id]
  if (!key) return info.id
  return t(key)
}

/** Look up a model by its ID. */
export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id)
}

/**
 * Build a human-readable pricing detail for the model picker tooltip.
 *
 * @param china  Whether the active endpoint is the China host.
 */
export function pricingDetail(info: ModelInfo, china = false): string {
  const currency = china ? '¥' : '$'
  const rate = china ? 7 : 1 // approximate CNY multiplier

  const base = PRICING[info.pricingKey]
  let inputRate = base.input * rate
  let outputRate = base.output * rate

  // Priority admission is billed at 1.5x the standard rate.
  if (info.tier === 'priority') {
    inputRate *= 1.5
    outputRate *= 1.5
  }

  const inputStr = inputRate < 1 ? inputRate.toFixed(2) : inputRate.toFixed(1)
  const outputStr =
    outputRate < 1 ? outputRate.toFixed(2) : outputRate.toFixed(1)

  return `${currency}${inputStr} / ${currency}${outputStr} per M tokens (PAYG)`
}
