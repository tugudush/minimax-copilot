/**
 * Minimal i18n for en + zh.
 *
 * Messages are keyed by a string id. The active locale is resolved
 * once at activation time from `vscode.env.language`; zh-cn / zh-tw
 * variants all map to `zh`.
 */

import * as vscode from 'vscode'

type Lang = 'en' | 'zh'

const messages: Record<string, Record<Lang, string>> = {
  'auth.setKey.title': {
    en: 'MiniMax: Set API Key',
    zh: 'MiniMax: 设置 API 密钥',
  },
  'auth.setKey.prompt': {
    en: 'Enter your MiniMax API key (pay-as-you-go or Token Plan)',
    zh: '输入您的 MiniMax API 密钥（按量付费 或 Token 套餐）',
  },
  'auth.setKey.saved': { en: 'API key saved.', zh: 'API 密钥已保存。' },
  'auth.setKey.empty': {
    en: 'No key entered — key not saved.',
    zh: '未输入密钥 — 未保存。',
  },
  'auth.clearKey.title': {
    en: 'MiniMax: Clear API Key',
    zh: 'MiniMax: 清除 API 密钥',
  },
  'auth.clearKey.cleared': { en: 'API key removed.', zh: 'API 密钥已移除。' },
  'auth.noKey': {
    en: 'No API key set. Run "MiniMax: Set API Key" first.',
    zh: '未设置 API 密钥。请先运行 "MiniMax: 设置 API 密钥"。',
  },

  'endpoint.switchGlobal.title': {
    en: 'MiniMax: Switch to Global API',
    zh: 'MiniMax: 切换到国际站',
  },
  'endpoint.switchGlobal.done': {
    en: 'Switched to Global API (api.minimax.io).',
    zh: '已切换到国际站 (api.minimax.io)。',
  },
  'endpoint.switchChina.title': {
    en: 'MiniMax: Switch to Chinese API',
    zh: 'MiniMax: 切换到中国站',
  },
  'endpoint.switchChina.done': {
    en: 'Switched to Chinese API (api.minimaxi.com).',
    zh: '已切换到中国站 (api.minimaxi.com)。',
  },

  'thinking.toggle.title': {
    en: 'MiniMax: Toggle Thinking',
    zh: 'MiniMax: 切换思维链',
  },
  'thinking.on': {
    en: 'M3 adaptive thinking: ON',
    zh: 'M3 自适应思维链：已开启',
  },
  'thinking.off': {
    en: 'M3 adaptive thinking: OFF',
    zh: 'M3 自适应思维链：已关闭',
  },

  'logs.title': { en: 'MiniMax: Show Logs', zh: 'MiniMax: 显示日志' },

  'error.401': {
    en: 'Invalid API key. Check your key and try again.',
    zh: 'API 密钥无效。请检查密钥后重试。',
  },
  'error.402': {
    en: 'Insufficient credits. Top up your account to continue.',
    zh: '余额不足。请充值后继续。',
  },
  'error.429': {
    en: 'Rate limited. Wait a moment and try again.',
    zh: '请求过于频繁。请稍后再试。',
  },
  'error.5xx': {
    en: 'MiniMax server error. Try again later.',
    zh: 'MiniMax 服务器错误。请稍后再试。',
  },
  'error.network': {
    en: 'Network error — check your connection.',
    zh: '网络错误 — 请检查连接。',
  },

  'model.m3.name': { en: 'MiniMax M3', zh: 'MiniMax M3' },
  'model.m3-priority.name': {
    en: 'MiniMax M3 (Priority)',
    zh: 'MiniMax M3（优先）',
  },
  'model.m2.7.name': { en: 'MiniMax M2.7', zh: 'MiniMax M2.7' },
  'model.m2.7-highspeed.name': {
    en: 'MiniMax M2.7 Highspeed',
    zh: 'MiniMax M2.7 高速',
  },

  'provider.noKey': {
    en: 'Set a MiniMax API key to use this model.',
    zh: '请设置 MiniMax API 密钥以使用此模型。',
  },

  'error.topUp': {
    en: 'Top Up',
    zh: '充值',
  },

  'walkthrough.welcome.title': {
    en: 'Get Started with MiniMax PAYG Copilot',
    zh: 'MiniMax PAYG Copilot 入门',
  },
  'walkthrough.welcome.description': {
    en: 'Set up your MiniMax API key, choose your region, and enable adaptive thinking.',
    zh: '设置 MiniMax API 密钥，选择区域，启用自适应思维链。',
  },
  'walkthrough.setKey.title': {
    en: 'Set API Key',
    zh: '设置 API 密钥',
  },
  'walkthrough.setKey.description': {
    en: 'Store your MiniMax PAYG API key securely.',
    zh: '安全存储您的 MiniMax 按量付费 API 密钥。',
  },
  'walkthrough.chooseRegion.title': {
    en: 'Choose Region',
    zh: '选择区域',
  },
  'walkthrough.chooseRegion.description': {
    en: 'Pick the China or Global endpoint for your account.',
    zh: '为您的账户选择中国站或国际站。',
  },
  'walkthrough.thinking.title': {
    en: 'Adaptive Thinking',
    zh: '自适应思维链',
  },
  'walkthrough.thinking.description': {
    en: 'M3 reasoning as a collapsible block in Copilot Chat.',
    zh: 'M3 推理在 Copilot Chat 中显示为可折叠的思维链块。',
  },
}

let currentLang: Lang = 'en'

/** Call once at activation to set the locale. */
export function initI18n(): void {
  const lang = vscode.env.language.toLowerCase()
  currentLang = lang.startsWith('zh') ? 'zh' : 'en'
}

/** Look up a message by key. Falls back to key if missing. */
export function t(key: string): string {
  const entry = messages[key]
  if (!entry) return key
  return entry[currentLang]
}

/** Get the active language code. */
export function lang(): Lang {
  return currentLang
}
