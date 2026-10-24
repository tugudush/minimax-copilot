# Adaptive Thinking (M3 family)

MiniMax M3 and M3.1 Flash support **adaptive reasoning**. The model
"thinks" before answering, and the reasoning appears as a
collapsible block in Copilot Chat.

Thinking is **on by default**. You can toggle it anytime:

[Toggle Thinking](command:minimax.toggleThinking)

> **M3.1 Flash always thinks** — the API rejects `thinking: disabled`.
> Tune its reasoning depth instead:
> [Set Thinking Effort](command:minimax.setThinkingEffort)
> (`low` → `max`).

> **Requires:** the `languageModelThinkingPart` proposed API.
> VS Code strips it from installed extensions by default — add
> `"enable-proposed-api": ["minimax-copilot-paygo.minimax-copilot"]`
> to `argv.json` (**Preferences: Configure Runtime Arguments**)
> and restart VS Code. See the README for details.
>
> Without it, chat still works — reasoning just won't appear as a
> separate block.
