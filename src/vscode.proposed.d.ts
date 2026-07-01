/**
 * Extension of vscode types for the proposed
 * `languageModelThinkingPart` API.
 *
 * These types are available at runtime only in VS Code builds that
 * have the proposal active (Insiders, or an approved signed build).
 * On stable VS Code, `vscode.LanguageModelThinkingPart` will be
 * `undefined` at runtime — the provider layer guards against this
 * and gracefully drops thinking content.
 *
 * @see https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts
 */
declare module 'vscode' {
  /**
   * A language model response part containing reasoning/thinking
   * content. When emitted by a chat provider, Copilot Chat renders
   * it as a collapsible "Thinking" block.
   */
  export class LanguageModelThinkingPart {
    /** The reasoning text, or an array of reasoning blocks. */
    value: string | string[]

    /**
     * Optional stable identifier for this thinking block.
     * Copilot Chat uses this to render the stateful
     * collapsible `ThinkingDataContainer`. Without an id
     * the part may render as inline text.
     */
    id?: string

    /** Optional metadata bag. */
    metadata?: Readonly<Record<string, unknown>>

    /**
     * @param value The reasoning text.
     * @param id Optional stable identifier for the block.
     */
    constructor(value: string, id?: string)
  }
}
