/**
 * Unit tests for `convert.ts` — VS Code messages → Anthropic params.
 *
 * Covers: system extraction, text parts, thinking-block replay with
 * signatures, and the round-trip correctness of thinking id/signature
 * preservation.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { convertMessages } from '../src/client/convert'
import { THINKING_ID_PREFIX } from '../src/consts'

const ROLE_SYSTEM = 0
const ROLE_USER = 1
const ROLE_ASSISTANT = 2

// ---- Helpers ----

/**
 * Build a mock VS Code text part.
 */
function textPart(value: string): { value: string } {
  return { value }
}

/**
 * Build a mock VS Code thinking part (duck-typed to match
 * LanguageModelThinkingPart when the proposal is unavailable).
 */
function thinkingPart(
  value: string,
  id: string
): { value: string; id: string } {
  return { value, id }
}

interface MockMessage {
  role: number
  name: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any[]
}

function msg(
  role: number,
  ...parts: { value: string; id?: string }[]
): MockMessage {
  return { role, name: undefined, content: parts }
}

function toolMsg(role: number, ...content: unknown[]): MockMessage {
  return { role, name: undefined, content }
}

interface ContentBlock {
  type: string
  thinking?: string
  signature?: string
  text?: string
  content?: string
  tool_use_id?: string
}

// ---- Tests ----

describe('convertMessages', () => {
  it('extracts system messages to the top-level system field', () => {
    const { system, messages } = convertMessages([
      msg(ROLE_SYSTEM, textPart('You are a helpful assistant.')),
      msg(ROLE_USER, textPart('Hello')),
    ])

    assert.strictEqual(system, 'You are a helpful assistant.')
    assert.strictEqual(messages.length, 1)
    const m0 = messages[0]!
    assert.strictEqual(m0.role, 'user')
    assert.deepStrictEqual(m0.content, [{ type: 'text', text: 'Hello' }])
  })

  it('concatenates multiple system messages', () => {
    const { system, messages } = convertMessages([
      msg(ROLE_SYSTEM, textPart('Be helpful.')),
      msg(ROLE_SYSTEM, textPart('Be concise.')),
      msg(ROLE_USER, textPart('Hi')),
    ])

    assert.strictEqual(system, 'Be helpful.\nBe concise.')
    assert.strictEqual(messages.length, 1)
  })

  it('converts user + assistant text messages', () => {
    const { system, messages } = convertMessages([
      msg(ROLE_USER, textPart('What is 2+2?')),
      msg(ROLE_ASSISTANT, textPart('It is 4.')),
    ])

    assert.strictEqual(system, undefined)
    assert.strictEqual(messages.length, 2)
    const m0 = messages[0]!
    const m1 = messages[1]!
    assert.strictEqual(m0.role, 'user')
    assert.strictEqual(m1.role, 'assistant')
    assert.deepStrictEqual(m0.content, [{ type: 'text', text: 'What is 2+2?' }])
    assert.deepStrictEqual(m1.content, [{ type: 'text', text: 'It is 4.' }])
  })

  it('skips empty messages', () => {
    const { messages } = convertMessages([
      msg(ROLE_USER, textPart('')),
      msg(ROLE_USER, textPart('Hello')),
      msg(ROLE_ASSISTANT, textPart('')),
    ])

    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0]!.role, 'user')
  })

  it('handles multi-part user messages (multiple text parts)', () => {
    const { messages } = convertMessages([
      msg(ROLE_USER, textPart('Part 1'), textPart('Part 2')),
    ])

    assert.strictEqual(messages.length, 1)
    const content = messages[0]!.content as ContentBlock[]
    assert.strictEqual(content.length, 2)
    assert.strictEqual(content[0]!.text, 'Part 1')
    assert.strictEqual(content[1]!.text, 'Part 2')
  })

  it('converts tool calls and raw tool results', () => {
    const { messages } = convertMessages([
      toolMsg(ROLE_ASSISTANT, {
        callId: 'call-1',
        name: 'git_status',
        input: { arg: '-s' },
      }),
      toolMsg(ROLE_USER, {
        callId: 'call-1',
        content: [{ value: 'M src/activate.ts' }],
      }),
    ])

    assert.strictEqual(messages.length, 2)
    assert.strictEqual(messages[0]!.role, 'assistant')
    assert.deepStrictEqual(messages[0]!.content, [
      {
        type: 'tool_use',
        id: 'call-1',
        name: 'git_status',
        input: { arg: '-s' },
      },
    ])
    assert.strictEqual(messages[1]!.role, 'user')
    assert.deepStrictEqual(messages[1]!.content, [
      {
        type: 'tool_result',
        tool_use_id: 'call-1',
        content: 'M src/activate.ts',
      },
    ])
  })

  it('converts tool results wrapped in a LanguageModelToolResult object containing a content array', () => {
    const { messages } = convertMessages([
      toolMsg(ROLE_USER, {
        callId: 'call-1',
        content: {
          content: [{ value: 'M src/activate.ts' }, { value: '?? docs/' }],
        },
      }),
    ])

    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0]!.role, 'user')
    assert.deepStrictEqual(messages[0]!.content, [
      {
        type: 'tool_result',
        tool_use_id: 'call-1',
        content: 'M src/activate.ts\n?? docs/',
      },
    ])
  })

  it('extracts text from LanguageModelDataPart tool results (Uint8Array + mimeType)', () => {
    // Reproduces the loop: command output returned as a DataPart (no .value),
    // which previously collapsed to '(empty)' and made the model re-propose
    // the same tool forever.
    const out = 'M src/activate.ts\n?? docs/'
    const { messages } = convertMessages([
      toolMsg(ROLE_USER, {
        callId: 'call-1',
        content: [
          { data: new TextEncoder().encode(out), mimeType: 'text/plain' },
        ],
      }),
    ])

    assert.strictEqual(messages.length, 1)
    const block = (messages[0]!.content as ContentBlock[])[0]!
    assert.strictEqual(block.type, 'tool_result')
    assert.strictEqual(block.tool_use_id, 'call-1')
    assert.strictEqual(block.content, out)
  })

  it('drops the synthetic cache_control DataPart instead of appending "[binary cache_control]" to real output', () => {
    // Copilot Chat appends a { mimeType: 'cache_control', data: 'ephemeral' }
    // marker part to some tool-result content arrays (a prompt-cache
    // breakpoint hint, not real tool output). Previously this fell into the
    // generic binary branch and got serialized as literal garbage text
    // appended after the real result (e.g. "feature/usage\n[binary
    // cache_control]"), polluting what the model reads back.
    const { messages } = convertMessages([
      toolMsg(ROLE_USER, {
        callId: 'call-1',
        content: [
          { value: 'feature/usage' },
          {
            data: new TextEncoder().encode('ephemeral'),
            mimeType: 'cache_control',
          },
        ],
      }),
    ])

    assert.strictEqual(messages.length, 1)
    const block = (messages[0]!.content as ContentBlock[])[0]!
    assert.strictEqual(block.type, 'tool_result')
    assert.strictEqual(block.content, 'feature/usage')
  })

  it('preserves LanguageModelPromptTsxPart tool results instead of dropping them to empty', () => {
    // Copilot Chat agent-mode tool results are frequently PromptTsxParts
    // whose .value is a rendered tree (not a plain string). These must not
    // collapse to '(empty)'.
    const { messages } = convertMessages([
      toolMsg(ROLE_USER, {
        callId: 'call-1',
        content: [{ value: { kind: 'text', text: 'On branch main' } }],
      }),
    ])

    assert.strictEqual(messages.length, 1)
    const block = (messages[0]!.content as ContentBlock[])[0]!
    assert.strictEqual(block.type, 'tool_result')
    assert.strictEqual(block.tool_use_id, 'call-1')
    // The whole part is serialized so the content survives for the model.
    assert.strictEqual(
      block.content,
      '{"value":{"kind":"text","text":"On branch main"}}'
    )
    assert.notStrictEqual(block.content, '(empty)')
  })
})

describe('thinking replay', () => {
  it('reconstructs thinking blocks in assistant messages with signatures', () => {
    const thinkingId = `${THINKING_ID_PREFIX}-3-0`
    const signatures = new Map<string, string>()
    signatures.set(thinkingId, 'sig-abc123')

    const { messages } = convertMessages(
      [
        msg(ROLE_USER, textPart('Explain recursion.')),
        msg(
          ROLE_ASSISTANT,
          thinkingPart('Let me think about this step by step...', thinkingId),
          textPart('Recursion is when a function calls itself.')
        ),
      ],
      signatures
    )

    assert.strictEqual(messages.length, 2)
    const assistantContent = messages[1]!.content as ContentBlock[]
    assert.strictEqual(assistantContent.length, 2)
    const b0 = assistantContent[0]!
    const b1 = assistantContent[1]!
    assert.strictEqual(b0.type, 'thinking')
    assert.strictEqual(b0.thinking, 'Let me think about this step by step...')
    assert.strictEqual(b0.signature, 'sig-abc123')
    assert.strictEqual(b1.type, 'text')
    assert.strictEqual(b1.text, 'Recursion is when a function calls itself.')
  })

  it('replays thinking blocks without signatures when map is empty', () => {
    const thinkingId = `${THINKING_ID_PREFIX}-7-1`

    const { messages } = convertMessages(
      [
        msg(
          ROLE_ASSISTANT,
          thinkingPart('Some reasoning...', thinkingId),
          textPart('Answer.')
        ),
      ],
      new Map()
    )

    const b0 = (messages[0]!.content as ContentBlock[])[0]!
    assert.strictEqual(b0.type, 'thinking')
    assert.strictEqual(b0.thinking, 'Some reasoning...')
    assert.strictEqual(b0.signature, '')
  })

  it('replays thinking blocks without signatures when map is not provided', () => {
    const thinkingId = `${THINKING_ID_PREFIX}-2-0`

    const { messages } = convertMessages([
      msg(
        ROLE_ASSISTANT,
        thinkingPart('Reasoning...', thinkingId),
        textPart('Done.')
      ),
    ])

    const b0 = (messages[0]!.content as ContentBlock[])[0]!
    assert.strictEqual(b0.type, 'thinking')
    assert.strictEqual(b0.thinking, 'Reasoning...')
    assert.strictEqual(b0.signature, '')
  })

  it('thinking parts in user messages are treated as thinking blocks (safe)', () => {
    const thinkingId = `${THINKING_ID_PREFIX}-0-0`
    const { messages } = convertMessages([
      msg(
        ROLE_USER,
        thinkingPart('User cannot think...', thinkingId),
        textPart('Hi')
      ),
    ])

    assert.strictEqual(messages.length, 1)
    assert.strictEqual(messages[0]!.role, 'user')
  })

  it('round-trips: signature lookup matches correct block id', () => {
    const sigs = new Map<string, string>()
    sigs.set(`${THINKING_ID_PREFIX}-1-0`, 'sig-a')
    sigs.set(`${THINKING_ID_PREFIX}-1-1`, 'sig-b')

    const { messages } = convertMessages(
      [
        msg(
          ROLE_ASSISTANT,
          thinkingPart('First thought.', `${THINKING_ID_PREFIX}-1-0`),
          textPart('Mid'),
          thinkingPart('Second thought.', `${THINKING_ID_PREFIX}-1-1`),
          textPart('End')
        ),
      ],
      sigs
    )

    const content = messages[0]!.content as ContentBlock[]
    assert.strictEqual(content.length, 4)

    const c0 = content[0]!
    assert.strictEqual(c0.type, 'thinking')
    assert.strictEqual(c0.signature, 'sig-a')
    assert.strictEqual(c0.thinking, 'First thought.')

    const c1 = content[1]!
    assert.strictEqual(c1.type, 'text')
    assert.strictEqual(c1.text, 'Mid')

    const c2 = content[2]!
    assert.strictEqual(c2.type, 'thinking')
    assert.strictEqual(c2.signature, 'sig-b')
    assert.strictEqual(c2.thinking, 'Second thought.')

    const c3 = content[3]!
    assert.strictEqual(c3.type, 'text')
    assert.strictEqual(c3.text, 'End')
  })
})
