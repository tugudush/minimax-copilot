/**
 * Command registrations — set/clear key, switch endpoint, toggle
 * thinking, show logs.
 *
 * All commands are registered once at activation via `registerCommands`.
 */

import * as vscode from 'vscode';
import { setApiKey, clearApiKey } from '../auth';
import { HOST_CHINA, HOST_GLOBAL, CONFIG_SECTION } from '../consts';
import { thinking } from '../config';
import { getChannel } from '../logger';
import { t } from '../i18n';

/** Register all MiniMax commands on the extension context. */
export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('minimax.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: t('auth.setKey.prompt'),
        password: true,
        placeHolder: 'sk-...',
      });

      if (key) {
        await setApiKey(context, key.trim());
        vscode.window.showInformationMessage(t('auth.setKey.saved'));
      } else {
        vscode.window.showWarningMessage(t('auth.setKey.empty'));
      }
    }),

    vscode.commands.registerCommand('minimax.clearApiKey', async () => {
      await clearApiKey(context);
      vscode.window.showInformationMessage(t('auth.clearKey.cleared'));
    }),

    vscode.commands.registerCommand('minimax.switchToGlobal', async () => {
      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update('apiBaseUrl', HOST_GLOBAL, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(t('endpoint.switchGlobal.done'));
    }),

    vscode.commands.registerCommand('minimax.switchToChina', async () => {
      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update('apiBaseUrl', HOST_CHINA, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(t('endpoint.switchChina.done'));
    }),

    vscode.commands.registerCommand('minimax.toggleThinking', async () => {
      const current = thinking();
      const next = !current;
      await vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .update('thinking', next, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(next ? t('thinking.on') : t('thinking.off'));
    }),

    vscode.commands.registerCommand('minimax.showLogs', () => {
      const channel = getChannel();
      channel.show(true);
    }),
  );
}
