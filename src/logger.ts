/**
 * Output-channel logger with API-key redaction.
 *
 * All extension logging goes through this module. In verbose mode
 * (`debugMode: 'verbose'`) full request bodies are written to a
 * temp file for inspection.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { debugMode } from './config';
import { OUTPUT_CHANNEL_NAME } from './consts';

let channel: vscode.LogOutputChannel | null = null;

/** Create (or return existing) output channel. */
export function getChannel(): vscode.LogOutputChannel {
  channel ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME, { log: true });
  return channel;
}

/** Redact sensitive values from a string. */
function redact(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-***')
    .replace(/Bearer\s+[^\s"]+/gi, 'Bearer ***')
    .replace(/"x-api-key"\s*:\s*"[^"]+"/gi, '"x-api-key":"***"');
}

/* ---- Public API ---- */

export function info(message: string): void {
  getChannel().info(message);
}

export function warn(message: string): void {
  getChannel().warn(message);
}

export function error(message: string): void {
  getChannel().error(message);
}

/** Log a request body (metadata mode: headers only; verbose: full body to disk). */
export function logRequest(method: string, url: string, body: unknown): void {
  const mode = debugMode();
  const safeUrl = redact(url);
  info(`${method} ${safeUrl}`);

  if (mode === 'verbose') {
    const dumpPath = path.join(os.tmpdir(), `minimax-request-${Date.now()}.json`);
    try {
      fs.writeFileSync(dumpPath, JSON.stringify(body, null, 2), 'utf-8');
      info(`Request body dumped to ${dumpPath}`);
    } catch {
      warn('Failed to write verbose request dump');
    }
  } else if (mode === 'metadata') {
    const bodyStr = JSON.stringify(body);
    info(`Request: ${redact(bodyStr).slice(0, 500)}`);
  }
}

/** Log a response summary (always minimal). */
export function logResponse(status: number, usage?: { input_tokens?: number; output_tokens?: number }): void {
  if (usage) {
    info(`Response ${status} — input: ${usage.input_tokens ?? '?'}, output: ${usage.output_tokens ?? '?'}`);
  } else {
    info(`Response ${status}`);
  }
}

/** Dispose the channel on deactivation. */
export function dispose(): void {
  channel?.dispose();
  channel = null;
}
