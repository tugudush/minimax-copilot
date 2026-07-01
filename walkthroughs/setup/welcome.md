# Get Started with MiniMax PAYG Copilot

Welcome! This walkthrough will help you get MiniMax M3 running in
Copilot Chat with a pay‑as‑you‑go key.

## 1. Get a MiniMax API key

Sign up at [platform.minimax.io](https://platform.minimax.io)
(International) or [platform.minimaxi.com](https://platform.minimaxi.com)
(China) and create an API key from your account dashboard.

## 2. Set your API key

Run **MiniMax: Set API Key** from the Command Palette
(`Ctrl+Shift+P`) and paste your key. It's stored securely in
VS Code's SecretStorage — never written to disk.

## 3. Choose your region

Run **MiniMax: Switch to Global API** or
**MiniMax: Switch to Chinese API** to match your key's region.
This ensures your requests hit the correct MiniMax endpoint.

## 4. Pick a model

Open **Copilot Chat** (`Ctrl+Shift+I`), click the model picker,
and select **MiniMax M3**. Start chatting — your PAYG key will
be billed per token.

> **Note:** The collapsible "Thinking" block requires a VS Code
> build with the `languageModelThinkingPart` proposal active
> (Insiders / approved). On stable VS Code, chat still works —
> reasoning just won't render as a separate collapsible block.
