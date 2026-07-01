/**
 * Model registry — MiniMax M3 / M2.7 definitions.
 *
 * Defines the four supported models with context windows, thinking
 * support, pricing tiers, and multimodal capability. The chat provider
 * reads this to build picker entries.
 */

import {
  MODEL_M3,
  MODEL_M3_PRIORITY,
  MODEL_M2_7,
  MODEL_M2_7_HIGHSPEED,
  M3_CONTEXT,
  M2_7_CONTEXT,
  PRICING,
} from '../consts'
import type { ModelInfo } from '../types'
import { t } from '../i18n'
import { isChinaHost } from '../runtime/endpoint'

/* ---- Model definitions ---- */

export const MODELS: ModelInfo[] = [
  {
    id: MODEL_M3,
    name: t('model.m3.name'),
    contextWindow: M3_CONTEXT,
    thinking: true,
    tier: 'standard',
    multimodal: true,
  },
  {
    id: MODEL_M3_PRIORITY,
    name: t('model.m3-priority.name'),
    contextWindow: M3_CONTEXT,
    thinking: true,
    tier: 'priority',
    multimodal: true,
  },
  {
    id: MODEL_M2_7,
    name: t('model.m2.7.name'),
    contextWindow: M2_7_CONTEXT,
    thinking: false,
    tier: 'standard',
    multimodal: false,
  },
  {
    id: MODEL_M2_7_HIGHSPEED,
    name: t('model.m2.7-highspeed.name'),
    contextWindow: M2_7_CONTEXT,
    thinking: false,
    tier: 'standard',
    multimodal: false,
  },
]

/** Look up a model by its ID. */
export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id)
}

/** Build a human-readable pricing detail for the model picker tooltip. */
export function pricingDetail(info: ModelInfo): string {
  const china = isChinaHost()
  const currency = china ? '¥' : '$'
  const rate = china ? 7 : 1 // approximate CNY multiplier

  let inputRate: number
  let outputRate: number

  if (info.id === MODEL_M3 || info.id === MODEL_M3_PRIORITY) {
    inputRate = PRICING.m3_standard.input * rate
    outputRate = PRICING.m3_standard.output * rate
    if (info.tier === 'priority') {
      inputRate *= 1.5
      outputRate *= 1.5
    }
  } else if (info.id === MODEL_M2_7_HIGHSPEED) {
    inputRate = PRICING.m2_7_highspeed.input * rate
    outputRate = PRICING.m2_7_highspeed.output * rate
  } else {
    inputRate = PRICING.m2_7.input * rate
    outputRate = PRICING.m2_7.output * rate
  }

  const inputStr = inputRate < 1 ? inputRate.toFixed(2) : inputRate.toFixed(1)
  const outputStr =
    outputRate < 1 ? outputRate.toFixed(2) : outputRate.toFixed(1)

  return `${currency}${inputStr} / ${currency}${outputStr} per M tokens (PAYG)`
}
