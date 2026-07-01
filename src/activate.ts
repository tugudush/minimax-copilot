import * as vscode from 'vscode';

/**
 * MiniMax PAYG Copilot — entry point.
 *
 * Registers the MiniMax chat provider so MiniMax M3 / M2.7 models
 * appear in the Copilot Chat model picker, sets up commands, and
 * eagerly activates GitHub Copilot Chat so the first model-picker
 * refresh reaches a live listener.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const logger = vscode.window.createOutputChannel('MiniMax PAYG Copilot', { log: true });
	context.subscriptions.push(logger);

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

	// TODO (Phase 1): register chat provider, commands, auth listener.
	// TODO (Phase 2): wire thinking + collapsible reasoning block.
}

/** Called when the extension is deactivated. */
export function deactivate(): void {
	// TODO (Phase 1): dispose provider subscriptions.
}
