/**
 * Locale-based endpoint auto-detection.
 *
 * On first activation, if the user hasn't set `minimax.apiBaseUrl`,
 * we pick the host based on `vscode.env.language`. The user can
 * override at any time via the Switch commands or the setting itself.
 */

import * as vscode from 'vscode';
import { HOST_CHINA, HOST_GLOBAL } from '../consts';
import { apiBaseUrl } from '../config';

/**
 * Resolve the active Anthropic-compatible base URL.
 *
 * Priority:
 * 1. User-configured `minimax.apiBaseUrl` (non-empty).
 * 2. Locale-based default: zh → China host, everything else → Global.
 */
export function resolveBaseUrl(): string {
  const configured = apiBaseUrl();
  if (configured) return configured;

  const lang = vscode.env.language.toLowerCase();
  return lang.startsWith('zh') ? HOST_CHINA : HOST_GLOBAL;
}

/** Whether the current host is the China endpoint. */
export function isChinaHost(): boolean {
  const url = resolveBaseUrl();
  return url.includes('minimaxi.com');
}

/** Get the billing/account URL for the active region. */
export function billingUrl(): string {
  return isChinaHost()
    ? 'https://platform.minimaxi.com/user-center/basic-information/account-manage'
    : 'https://platform.minimax.io/user-center/basic-information/account-manage';
}
