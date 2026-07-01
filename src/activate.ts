import * as vscode from 'vscode';
import { initI18n } from './i18n';
import * as logger from './logger';
import { MiniMaxChatProvider } from './provider/index';
import { registerCommands } from './runtime/commands';

/**
 * MiniMax PAYG Copilot — entry point.
 *
 * Registers the MiniMax chat provider so MiniMax M3 / M2.7 models
 * appear in the Copilot Chat model picker, sets up commands, and
 * eagerly activates GitHub Copilot Chat so the first model-picker
 * refresh reaches a live listener.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Initialize locale-aware strings.
  initI18n();

  logger.info('MiniMax PAYG Copilot activated');
  logger.info(`VS Code ${vscode.version} — language: ${vscode.env.language}`);

  // Eagerly activate Copilot Chat so the model picker picks us up on first open.
  try {
    const copilotChat = vscode.extensions.getExtension('github.copilot-chat');
    if (copilotChat && !copilotChat.isActive) {
      await copilotChat.activate();
      logger.info('Copilot Chat activated');
    }
  } catch {
    // Non-fatal: Copilot Chat may not be installed.
    logger.warn('Could not activate Copilot Chat — is it installed?');
  }

  // Register the chat provider — this is what surfaces MiniMax models
  // in the Copilot Chat model picker.
  const provider = new MiniMaxChatProvider(context);
  context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider('minimax', provider));
  context.subscriptions.push({
    dispose: () => {
      provider.dispose();
    },
  });

  // Register user-facing commands (set/clear key, switch endpoint, etc.).
  registerCommands(context);

  logger.info('Phase 1 provider and commands registered');
}

/** Called when the extension is deactivated. */
export function deactivate(): void {
  logger.dispose();
}
