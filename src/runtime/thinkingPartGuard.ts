/**
 * Runtime guard for the `languageModelThinkingPart` proposed API.
 *
 * Because `vscode` is only available inside the VS Code extension
 * host (not in Node.js unit tests), we use a lazy `require` wrapped
 * in try/catch. Returns `null` when the proposal isn't active.
 *
 * Used by `client.ts` (to emit thinking parts) and `convert.ts`
 * (to detect thinking parts in message history for replay).
 */

type Require = (id: string) => unknown

let _thinkingCtor: (new (...args: unknown[]) => unknown) | null | undefined

/**
 * Return the `LanguageModelThinkingPart` constructor if the
 * proposal is active in this VS Code build, or `null` otherwise.
 */
export function getThinkingPartCtor():
  (new (...args: unknown[]) => unknown) | null {
  if (_thinkingCtor !== undefined) {
    return _thinkingCtor
  }

  try {
    // Dynamic require works in the VS Code extension host where
    // the 'vscode' module is injected. In Node.js tests it throws.
    const nodeReq = require as Require
    const vscodeMod = nodeReq('vscode') as Record<string, unknown>
    if (typeof vscodeMod.LanguageModelThinkingPart === 'function') {
      _thinkingCtor = vscodeMod.LanguageModelThinkingPart as new (
        ...args: unknown[]
      ) => unknown
    } else {
      _thinkingCtor = null
    }
  } catch {
    // vscode not available — tests or non-VS Code environment
    _thinkingCtor = null
  }

  return _thinkingCtor
}

/**
 * True when the `LanguageModelThinkingPart` constructor is available.
 */
export function isThinkingPartAvailable(): boolean {
  return getThinkingPartCtor() !== null
}
