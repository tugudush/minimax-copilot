/**
 * Configuration accessors for `minimax.*` settings.
 *
 * Every read goes through `vscode.workspace.getConfiguration('minimax')`
 * so pickups happen live — no caching.
 */

import * as vscode from 'vscode'
import { CONFIG_SECTION } from './consts'

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION)
}

/** Anthropic-compatible base URL. Falls back to '' (let endpoint.ts decide). */
export function apiBaseUrl(): string {
  return cfg().get<string>('apiBaseUrl', '')
}

/** Whether adaptive thinking is on for M3 (default true). */
export function thinking(): boolean {
  return cfg().get<boolean>('thinking', true)
}

/** Model filter list. Empty = all models visible. */
export function visibleModels(): string[] {
  return cfg().get<string[]>('visibleModels', [])
}

/** Output token cap per request. 0 = model decides. */
export function maxOutputTokens(): number {
  return cfg().get<number>('maxOutputTokens', 0)
}

/** Debug verbosity: 'minimal' | 'metadata' | 'verbose'. */
export function debugMode(): string {
  return cfg().get<string>('debugMode', 'minimal')
}
