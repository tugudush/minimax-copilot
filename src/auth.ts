/**
 * Auth — single API key in SecretStorage.
 *
 * The key lives exclusively in VS Code's SecretStorage. It is never
 * written to settings or globalState. A simple event emitter notifies
 * subscribers (the chat provider) when the key changes so the model
 * picker can refresh.
 */

import * as vscode from 'vscode'
import { SECRET_KEY } from './consts'

/* ---- Event emitter ---- */

const _emitter = new vscode.EventEmitter<string | undefined>()
export const onDidChangeApiKey: vscode.Event<string | undefined> =
  _emitter.event

/* ---- Public API ---- */

/** Read the stored API key (undefined if not set). */
export async function getApiKey(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  return context.secrets.get(SECRET_KEY)
}

/** Store an API key in SecretStorage. */
export async function setApiKey(
  context: vscode.ExtensionContext,
  key: string
): Promise<void> {
  await context.secrets.store(SECRET_KEY, key)
  _emitter.fire(key)
}

/** Remove the stored API key. */
export async function clearApiKey(
  context: vscode.ExtensionContext
): Promise<void> {
  await context.secrets.delete(SECRET_KEY)
  _emitter.fire(undefined)
}

/** Check whether a key is currently stored. */
export async function hasApiKey(
  context: vscode.ExtensionContext
): Promise<boolean> {
  const key = await getApiKey(context)
  return !!key
}

/** Dispose the event emitter (called on deactivation). */
export function dispose(): void {
  _emitter.dispose()
}
