/**
 * Constants shared across the MiniMax PAYG Copilot extension.
 *
 * All MiniMax-specific identifiers, URLs, secret keys, and model IDs
 * live here so the rest of the codebase stays DRY.
 */

/* ---- Secret-storage key ---- */
export const SECRET_KEY = 'minimax-paygo.apiKey'

/* ---- Anthropic-compatible endpoint hosts ---- */
export const HOST_CHINA = 'https://api.minimaxi.com/anthropic'
export const HOST_GLOBAL = 'https://api.minimax.io/anthropic'

/* ---- Configuration section ---- */
export const CONFIG_SECTION = 'minimax'

/* ---- Model IDs ---- */
export const MODEL_M3 = 'minimax-m3'
export const MODEL_M3_PRIORITY = 'minimax-m3-priority'
export const MODEL_M2_7 = 'minimax-m2.7'
export const MODEL_M2_7_HIGHSPEED = 'minimax-m2.7-highspeed'

/* ---- Context limits ---- */
export const M3_CONTEXT = 1_048_576 // 1M
export const M2_7_CONTEXT = 204_800

/* ---- Output channel name ---- */
export const OUTPUT_CHANNEL_NAME = 'MiniMax PAYG Copilot'

/* ---- Thinking block id prefix ---- */
export const THINKING_ID_PREFIX = 'minimax-thinking'

/* ---- PAYG pricing (USD per million tokens) ----
 *
 * Only the keys actually consumed by `src/models/registry.ts` are
 * kept here. If a long-context M3 tier is added later, or if cache
 * write pricing needs to be displayed in the picker tooltip, add the
 * missing keys back in this same shape.
 */
export const PRICING = {
  m3_standard: { input: 0.3, output: 1.2, cacheRead: 0.06 },
  m2_7: { input: 0.3, output: 1.2, cacheRead: 0.06 },
  m2_7_highspeed: { input: 0.6, output: 2.4, cacheRead: 0.06 },
} as const

/* ---- Platform billing URL ---- */
export const BILLING_URL_CHINA =
  'https://platform.minimaxi.com/user-center/basic-information/account-manage'
export const BILLING_URL_GLOBAL =
  'https://platform.minimax.io/user-center/basic-information/account-manage'
