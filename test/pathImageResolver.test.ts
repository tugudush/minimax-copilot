/**
 * Unit tests for `runtime/pathImageExtractor.ts` and the public
 * entry point in `runtime/pathImageResolver.ts`.
 *
 * No `vscode` module is loaded — the tests use plain duck-typed
 * shapes (mirroring `test/convert.test.ts`) and the `FileReader`
 * injection seam to fake filesystem results.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  extractCandidatePaths,
  isSupportedImagePath,
} from '../src/runtime/pathImageExtractor'
import {
  inlinePathImages,
  type FileReader,
} from '../src/runtime/pathImageResolver'

const ROLE_USER = 1
const ROLE_ASSISTANT = 2

// Minimal structural shape matching `vscode.LanguageModelChatRequestMessage`.
// `name` is part of the real type's required shape, so we include it
// (always `undefined`).
interface MockMessage {
  role: number
  content: { value?: string; data?: Uint8Array; mimeType?: string }[]
  name: undefined
}

interface ResolvedImage {
  data: Uint8Array
  mimeType: string
}

interface FakeReaderCall {
  candidate: string
  maxBytes: number
}

/**
 * Build a `FileReader` that resolves a fixed set of (candidate → bytes)
 * pairs. Calls are recorded so tests can assert on them.
 */
function fakeReader(entries: Record<string, ResolvedImage | null>): {
  reader: FileReader
  calls: FakeReaderCall[]
} {
  const calls: FakeReaderCall[] = []
  return {
    calls,
    reader: {
      resolve(candidate, ctx) {
        calls.push({ candidate, maxBytes: ctx.maxBytes })
        return Promise.resolve(entries[candidate] ?? null)
      },
    },
  }
}

function textMsg(role: number, value: string): MockMessage {
  return { role, name: undefined, content: [{ value }] }
}

// `inlinePathImages` expects the VS Code message type. The mock
// shapes are structurally compatible — narrow through `unknown`
// because the resolver only reads `.role` and `.content`, and
// writes a same-shape message back. Mirrors the pragmatic
// approach used in `test/convert.test.ts`.
function toVsCodeMessages(msgs: readonly MockMessage[]) {
  return msgs as unknown as Parameters<typeof inlinePathImages>[0]
}

// ---- Extractor tests (no vscode needed) ----

describe('isSupportedImagePath', () => {
  it('accepts each supported image extension', () => {
    assert.strictEqual(isSupportedImagePath('docs/foo.png'), true)
    assert.strictEqual(isSupportedImagePath('docs/foo.PNG'), true)
    assert.strictEqual(isSupportedImagePath('docs/foo.jpg'), true)
    assert.strictEqual(isSupportedImagePath('docs/foo.jpeg'), true)
    assert.strictEqual(isSupportedImagePath('docs/foo.JPEG'), true)
    assert.strictEqual(isSupportedImagePath('docs/foo.gif'), true)
    assert.strictEqual(isSupportedImagePath('docs/foo.webp'), true)
  })

  it('rejects non-image extensions', () => {
    assert.strictEqual(isSupportedImagePath('docs/foo.txt'), false)
    assert.strictEqual(isSupportedImagePath('docs/foo'), false)
    assert.strictEqual(isSupportedImagePath('docs/foo.mp4'), false)
  })

  it('handles trailing delimiters gracefully', () => {
    assert.strictEqual(isSupportedImagePath('docs/foo.png.'), true)
    assert.strictEqual(isSupportedImagePath('docs/foo.png,'), true)
    assert.strictEqual(isSupportedImagePath('docs/foo.png)'), true)
    assert.strictEqual(isSupportedImagePath('"docs/foo.png"'), true)
  })

  it('rejects empty or near-empty strings', () => {
    assert.strictEqual(isSupportedImagePath(''), false)
    assert.strictEqual(isSupportedImagePath('.png'), false)
    assert.strictEqual(isSupportedImagePath('img'), false)
  })
})

describe('extractCandidatePaths', () => {
  it('returns a single bare path with index range', () => {
    const text = 'look at docs/foo.png please'
    const cands = extractCandidatePaths(text)
    assert.strictEqual(cands.length, 1)
    assert.strictEqual(cands[0]!.value, 'docs/foo.png')
    assert.strictEqual(
      text.slice(cands[0]!.start, cands[0]!.end),
      'docs/foo.png'
    )
  })

  it('returns multiple candidates in document order', () => {
    const text = 'compare docs/a.png and docs/b.jpg'
    const cands = extractCandidatePaths(text)
    assert.strictEqual(cands.length, 2)
    assert.strictEqual(cands[0]!.value, 'docs/a.png')
    assert.strictEqual(cands[1]!.value, 'docs/b.jpg')
  })

  it('handles Windows absolute path', () => {
    const cands = extractCandidatePaths(
      'see C:\\Users\\me\\pics\\cat.png for details'
    )
    assert.strictEqual(cands.length, 1)
    assert.strictEqual(cands[0]!.value, 'C:\\Users\\me\\pics\\cat.png')
  })

  it('handles POSIX absolute path', () => {
    const cands = extractCandidatePaths('see /home/me/pics/cat.png for details')
    assert.strictEqual(cands.length, 1)
    assert.strictEqual(cands[0]!.value, '/home/me/pics/cat.png')
  })

  it('handles file:// URI', () => {
    const cands = extractCandidatePaths(
      'see file:///c:/Users/me/pics/cat.png please'
    )
    assert.strictEqual(cands.length, 1)
    assert.strictEqual(cands[0]!.value, 'file:///c:/Users/me/pics/cat.png')
  })

  it('handles #file: reference', () => {
    const cands = extractCandidatePaths('see #file:docs/foo.png please')
    assert.strictEqual(cands.length, 1)
    assert.strictEqual(cands[0]!.value, '#file:docs/foo.png')
  })

  it('ignores URL with embedded path-like suffix', () => {
    // The "before" lookahead strips `https://` so the suffix
    // `.png?x=1` doesn't get misread as a path.
    const cands = extractCandidatePaths(
      'try https://example.com/foo.png?x=1 instead'
    )
    assert.strictEqual(cands.length, 0)
  })

  it('ignores non-image paths', () => {
    const cands = extractCandidatePaths('open docs/readme.txt for context')
    assert.strictEqual(cands.length, 0)
  })

  it('returns empty for empty input', () => {
    assert.deepStrictEqual(extractCandidatePaths(''), [])
  })
})

// ---- Resolver integration tests (with fake FileReader) ----

describe('inlinePathImages', () => {
  it('returns input unchanged when disabled', async () => {
    const { reader, calls } = fakeReader({})
    const input = [textMsg(ROLE_USER, 'look at docs/foo.png')]
    const out = await inlinePathImages(
      toVsCodeMessages(input),
      { enabled: false, maxBytes: 0 },
      reader
    )
    assert.strictEqual(out.length, 1)
    assert.strictEqual(out[0], input[0]) // same reference — no scan happened
    assert.strictEqual(calls.length, 0)
  })

  it('inlines a single image and splits text around it', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const { reader } = fakeReader({
      'docs/foo.png': { data: png, mimeType: 'image/png' },
    })

    const out = await inlinePathImages(
      toVsCodeMessages([textMsg(ROLE_USER, 'look at docs/foo.png please')]),
      { enabled: true, maxBytes: 0 },
      reader
    )

    assert.strictEqual(out.length, 1)
    const content = out[0]!.content as {
      value?: string
      data?: Uint8Array
      mimeType?: string
    }[]
    assert.strictEqual(content.length, 3)
    assert.strictEqual(content[0]!.value, 'look at ')
    assert.strictEqual(content[1]!.data!.length, 4)
    assert.strictEqual(content[1]!.mimeType, 'image/png')
    assert.strictEqual(content[2]!.value, ' please')
  })

  it('inlines multiple images in document order', async () => {
    const a = new Uint8Array([1, 2])
    const b = new Uint8Array([3, 4])
    const { reader } = fakeReader({
      'docs/a.png': { data: a, mimeType: 'image/png' },
      'docs/b.jpg': { data: b, mimeType: 'image/jpeg' },
    })

    const out = await inlinePathImages(
      toVsCodeMessages([
        textMsg(ROLE_USER, 'compare docs/a.png and docs/b.jpg now'),
      ]),
      { enabled: true, maxBytes: 0 },
      reader
    )

    const content = out[0]!.content as {
      value?: string
      data?: Uint8Array
      mimeType?: string
    }[]
    // Expected: 'compare ' text, a image, ' and ' text, b image, ' now' text
    assert.strictEqual(content.length, 5)
    assert.strictEqual(content[0]!.value, 'compare ')
    assert.strictEqual(content[1]!.mimeType, 'image/png')
    assert.strictEqual(content[2]!.value, ' and ')
    assert.strictEqual(content[3]!.mimeType, 'image/jpeg')
    assert.strictEqual(content[4]!.value, ' now')
  })

  it('leaves the text part unchanged when no candidate resolves', async () => {
    const { reader } = fakeReader({}) // nothing resolves
    const input = [textMsg(ROLE_USER, 'look at docs/missing.png please')]
    const out = await inlinePathImages(
      toVsCodeMessages(input),
      { enabled: true, maxBytes: 0 },
      reader
    )

    // Original text part survives — no falsy "everything dropped" rewrite.
    const content = out[0]!.content as {
      value?: string
      data?: Uint8Array
      mimeType?: string
    }[]
    assert.strictEqual(content.length, 1)
    assert.strictEqual(content[0]!.value, input[0]!.content[0]!.value)
  })

  it('passes maxBytes through to the reader', async () => {
    const { reader, calls } = fakeReader({})
    await inlinePathImages(
      toVsCodeMessages([textMsg(ROLE_USER, 'docs/foo.png')]),
      { enabled: true, maxBytes: 1024 },
      reader
    )
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0]!.maxBytes, 1024)
  })

  it('passes supported path candidates to the reader but skips non-image paths', async () => {
    const { reader, calls } = fakeReader({})
    await inlinePathImages(
      toVsCodeMessages([
        textMsg(ROLE_USER, 'docs/foo.png and docs/readme.txt'),
      ]),
      { enabled: true, maxBytes: 0 },
      reader
    )
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0]!.candidate, 'docs/foo.png')
  })

  it('handles image at start of text (no leading text part)', async () => {
    const png = new Uint8Array([9])
    const { reader } = fakeReader({
      'docs/a.png': { data: png, mimeType: 'image/png' },
    })

    const out = await inlinePathImages(
      toVsCodeMessages([textMsg(ROLE_USER, 'docs/a.png is the chart')]),
      { enabled: true, maxBytes: 0 },
      reader
    )

    const content = out[0]!.content as {
      value?: string
      data?: Uint8Array
      mimeType?: string
    }[]
    // No leading empty text part — straight image then ' is the chart'.
    assert.strictEqual(content.length, 2)
    assert.strictEqual(content[0]!.mimeType, 'image/png')
    assert.strictEqual(content[1]!.value, ' is the chart')
  })

  it('handles image at end of text (no trailing text part)', async () => {
    const png = new Uint8Array([9])
    const { reader } = fakeReader({
      'docs/a.png': { data: png, mimeType: 'image/png' },
    })

    const out = await inlinePathImages(
      toVsCodeMessages([textMsg(ROLE_USER, 'see docs/a.png')]),
      { enabled: true, maxBytes: 0 },
      reader
    )

    const content = out[0]!.content as {
      value?: string
      data?: Uint8Array
      mimeType?: string
    }[]
    assert.strictEqual(content.length, 2)
    assert.strictEqual(content[0]!.value, 'see ')
    assert.strictEqual(content[1]!.mimeType, 'image/png')
  })

  it('does not scan assistant-message text', async () => {
    const { reader, calls } = fakeReader({})
    const input = [textMsg(ROLE_ASSISTANT, 'see docs/foo.png')]
    await inlinePathImages(
      toVsCodeMessages(input),
      { enabled: true, maxBytes: 0 },
      reader
    )
    assert.strictEqual(calls.length, 0, 'assistant messages are not scanned')
  })

  it('passes data parts through unchanged', async () => {
    const { reader, calls } = fakeReader({})
    const dataPart = {
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: 'image/png',
    }
    const input: MockMessage[] = [
      { role: ROLE_USER, name: undefined, content: [dataPart] },
    ]
    const out = await inlinePathImages(
      toVsCodeMessages(input),
      { enabled: true, maxBytes: 0 },
      reader
    )
    const content = out[0]!.content as unknown[]
    assert.strictEqual(content.length, 1)
    assert.strictEqual(content[0], dataPart) // same reference — untouched
    assert.strictEqual(calls.length, 0)
  })

  it('preserves order when text and data parts are interleaved', async () => {
    const png = new Uint8Array([0x89, 0x50])
    const attached = {
      data: new Uint8Array([0xff, 0xd8]),
      mimeType: 'image/jpeg',
    }
    const { reader } = fakeReader({
      'docs/inner.png': { data: png, mimeType: 'image/png' },
    })
    const input: MockMessage[] = [
      {
        role: ROLE_USER,
        name: undefined,
        content: [{ value: 'see attached and docs/inner.png' }, attached],
      },
    ]
    const out = await inlinePathImages(
      toVsCodeMessages(input),
      { enabled: true, maxBytes: 0 },
      reader
    )

    const content = out[0]!.content as {
      value?: string
      data?: Uint8Array
      mimeType?: string
    }[]
    // Expected order: 'see attached and ' (text), inner PNG, attached JPEG
    // (data part — untouched)
    assert.strictEqual(content.length, 3)
    assert.strictEqual(content[0]!.value, 'see attached and ')
    assert.strictEqual(content[1]!.mimeType, 'image/png')
    assert.strictEqual(content[1]!.data, png)
    assert.strictEqual(content[2]!.mimeType, 'image/jpeg')
    assert.strictEqual(content[2]!.data, attached.data)
  })
})
