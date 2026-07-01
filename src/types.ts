/**
 * TypeScript type definitions for MiniMax / Anthropic-compatible API.
 *
 * These mirror the relevant subset of @anthropic-ai/sdk types we use
 * directly, plus MiniMax-specific extensions (usage, pricing tier).
 */

import type Anthropic from '@anthropic-ai/sdk';

/* ---- Re-export key Anthropic types for convenience ---- */
export type AnthropicMessage = Anthropic.Messages.Message;
export type AnthropicContentBlock = Anthropic.Messages.ContentBlock;
export type AnthropicTextBlock = Anthropic.Messages.TextBlock;
export type AnthropicToolUseBlock = Anthropic.Messages.ToolUseBlock;
export type AnthropicThinkingBlock = Anthropic.Messages.ThinkingBlock;
export type AnthropicUsage = Anthropic.Messages.Usage;

export type AnthropicMessageParam = Anthropic.Messages.MessageParam;
export type AnthropicContentBlockParam = Anthropic.Messages.ContentBlockParam;

export type AnthropicStreamEvent = Anthropic.Messages.RawMessageStreamEvent;

/* ---- MiniMax model tier ---- */
export type ModelTier = 'standard' | 'priority';

/* ---- Model descriptor ---- */
export interface ModelInfo {
  /** Model ID sent in API requests. */
  id: string;
  /** Display name in the model picker. */
  name: string;
  /** Maximum context window (tokens). */
  contextWindow: number;
  /** Whether adaptive thinking is supported. */
  thinking: boolean;
  /** Service tier (standard / priority). */
  tier: ModelTier;
  /** Whether image/video input is supported. */
  multimodal: boolean;
}
