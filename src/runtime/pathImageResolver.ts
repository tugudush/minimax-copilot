/**
 * Path-referenced image inliner.
 *
 * Scans user-message text for image paths (`docs/foo.png`,
 * `C:\path\foo.png`, `file:///path/foo.png`, `#file:foo.png`),
 * resolves them against the workspace or absolute filesystem,
 * reads the bytes, and splices them into the message content as
 * `LanguageModelDataPart` blocks. From there, `convert.ts`'s
 * image branch (`docs/bugs/vision.md` §6) emits them as
 * Anthropic `image` content blocks without further changes.
 *
 * Lives in `runtime/` (not `client/`) because it needs the
 * `vscode` module for `workspace.fs` and `workspace.workspaceFolders`.
 * Uses lazy `require` so the file is still importable from Node-only
 * test runners (see `thinkingPartGuard.ts` for the same pattern).
 */

import {
  extractCandidatePaths,
  isSupportedImagePath,
} from './pathImageExtractor'

/* `vscode` is type-only (erased at compile time) so the file stays
 * Node-only loadable for tests; the runtime helpers (workspace.fs,
 * Uri, workspaceFolders) are reached via lazy `nodeRequire('vscode')`
 * inside `resolveViaVsCode`. Mirrors the pattern in
 * `runtime/thinkingPartGuard.ts`. */
import type * as vscode from 'vscode'

/* ---- Lazy logger (avoids pulling `vscode` into the module graph for tests). */
type RequireFn = (id: string) => unknown
const nodeRequire = require as RequireFn

interface Logger {
  info: (msg: string) => void
  warn: (msg: string) => void
}

function noop(): void {
  /* no-op */
}

function getLogger(): Logger {
  try {
    const mod = nodeRequire('../logger') as {
      info: (m: string) => void
      warn: (m: string) => void
    }
    return { info: mod.info.bind(mod), warn: mod.warn.bind(mod) }
  } catch {
    return { info: noop, warn: noop }
  }
}

/** Per-request options. */
export interface PathImageOptions {
  /** When false, `inlinePathImages` is a no-op. */
  readonly enabled: boolean
  /** Skip files larger than this (bytes). 0 = no cap. */
  readonly maxBytes: number
}

/** Injection seam so tests can swap out filesystem access. */
export interface FileReader {
  /**
   * Resolve a path candidate to a `LanguageModelDataPart`-shaped
   * object, or `null` if the path doesn't resolve to a readable
   * image within the configured limits.
   */
  resolve(
    candidate: string,
    ctx: FileReaderContext
  ): Promise<{ data: Uint8Array; mimeType: string } | null>
}

/** Per-call context passed to `FileReader.resolve`. */
export interface FileReaderContext {
  readonly maxBytes: number
  readonly cancellationToken?: { isCancellationRequested: boolean }
}

/** A single content part in a chat message. We accept anything — the
 * downstream `convert.ts` duck-types each branch. Tests pass plain
 * objects; the provider passes real VS Code parts.
 *
 * The function signature accepts `vscode.LanguageModelChatRequestMessage[]`
 * directly via structural compatibility (the public type uses the
 * exact VS Code type via `import type`, which is erased at compile time). */
type LlmMessage = vscode.LanguageModelChatRequestMessage

/** Splices emit these duck-typed shapes. `convert.ts` recognizes them. */
interface MutablePart {
  value?: string
  data?: Uint8Array
  mimeType?: string
}

/** Default `FileReader` backed by `vscode.workspace.fs` (lazy-loaded). */
let _defaultReader: FileReader | null = null
function getDefaultReader(): FileReader {
  if (_defaultReader !== null) return _defaultReader
  _defaultReader = createDefaultReader()
  return _defaultReader
}

/** Test hook: install a different default reader, or restore the vscode-backed one. */
export function __setDefaultReaderForTests(reader: FileReader | null): void {
  _defaultReader = reader
}

/* ---- Public entry point ---- */

/**
 * Walk `vscodeMessages` and inline any user-message text parts whose
 * value contains a resolvable image path. Returns a new array with the
 * same role/name as the inputs, but content may now contain
 * `LanguageModelDataPart` blocks alongside text.
 *
 * Per-path failures (ENOENT, oversize, permission) are swallowed —
 * the original text is preserved so the model still sees the path.
 * Each path is logged.
 */
export async function inlinePathImages(
  vscodeMessages: readonly LlmMessage[],
  options: PathImageOptions,
  reader?: FileReader,
  cancellationToken?: { isCancellationRequested: boolean }
): Promise<LlmMessage[]> {
  if (!options.enabled) return vscodeMessages.slice()
  if (vscodeMessages.length === 0) return vscodeMessages.slice()

  const r = reader ?? getDefaultReader()
  const out: LlmMessage[] = []

  for (const msg of vscodeMessages) {
    // Only scan user-message text parts. Assistant / system / tool
    // content is left untouched (per plan §0).
    //
    // The explicit `number` widening silences
    // `@typescript-eslint/no-unsafe-enum-comparison` for the
    // `ROLE_USER_INT` (number literal) comparison.
    const role: number = msg.role
    if (role !== ROLE_USER_INT) {
      out.push(msg)
      continue
    }

    const content: readonly unknown[] = Array.isArray(msg.content)
      ? msg.content
      : []
    const newContent: MutablePart[] = []
    let inlinedAny = false

    for (const part of content) {
      const text = getTextValue(part)
      if (typeof text !== 'string' || text.length === 0) {
        newContent.push(part as MutablePart)
        continue
      }

      const candidates = extractCandidatePaths(text)
      if (candidates.length === 0) {
        newContent.push(part as MutablePart)
        continue
      }

      // Process each candidate in document order, splicing the part
      // into a `text / image / text / image / ...` sequence.
      const ctx: FileReaderContext = {
        maxBytes: options.maxBytes,
        cancellationToken,
      }

      let cursor = 0
      let partInlined = false
      for (const cand of candidates) {
        if (cancellationToken?.isCancellationRequested) break

        const imagePart = await r.resolve(cand.value, ctx)
        if (imagePart) {
          const before = text.slice(cursor, cand.start)
          if (before.length > 0) newContent.push({ value: before })
          newContent.push({
            data: imagePart.data,
            mimeType: imagePart.mimeType,
          })
          inlinedAny = true
          partInlined = true
          cursor = cand.end
        }
      }

      // Whatever is left after the last candidate, plus the rest of
      // the original text if nothing matched.
      const after = text.slice(cursor)
      if (after.length > 0) {
        newContent.push({ value: after })
      } else if (!partInlined) {
        // No candidate resolved — keep the original text part as-is
        // so any metadata (id, etc.) survives.
        newContent.push(part as MutablePart)
      }
      // else: every candidate resolved and we just emitted trailing
      // text (possibly empty). Empty trailing text is harmless —
      // convert.ts drops empty text blocks.
    }

    if (inlinedAny) {
      getLogger().info(
        `Inlined ${countInlined(newContent)} image(s) from user message paths`
      )
    }

    out.push({ ...msg, content: newContent })
  }

  return out
}

/* ---- Internal helpers ---- */

/**
 * Magic `1` for the user role. `vscode.LanguageModelChatMessageRole`
 * is an enum (`User = 1, Assistant = 2`), and comparing the message's
 * role against this const at runtime is unambiguous — but TypeScript
 * flags the comparison as `no-unsafe-enum-comparison` because we
 * don't have the enum on hand. The int-1 reference is the same value
 * the enum compiles to.
 */
const ROLE_USER_INT = 1

/**
 * Pull the `.value` string out of a text-shaped part. Returns
 * `undefined` for non-text parts (e.g. data parts, tool call parts)
 * so we don't accidentally scan them.
 */
function getTextValue(part: unknown): string | undefined {
  if (typeof part === 'string') return part
  if (part === null || typeof part !== 'object') return undefined
  const p = part as { value?: unknown }
  return typeof p.value === 'string' ? p.value : undefined
}

/** Count image-shaped parts in a content array (after the fact). */
function countInlined(content: MutablePart[]): number {
  let n = 0
  for (const p of content) {
    if (
      p.mimeType !== undefined &&
      typeof p.mimeType === 'string' &&
      p.data instanceof Uint8Array
    ) {
      n++
    }
  }
  return n
}

/* ---- Default reader (backed by vscode.workspace.fs) ---- */

interface VsCodeModule {
  Uri: {
    parse(value: string): unknown
    file(path: string): unknown
    joinPath(base: unknown, ...parts: string[]): unknown
  }
  workspace: {
    workspaceFolders?: { uri: unknown }[]
    fs: {
      stat(uri: unknown): Promise<{ type: number }>
      readFile(uri: unknown): Promise<Uint8Array>
    }
  }
}

function createDefaultReader(): FileReader {
  return {
    resolve: async (candidate, ctx) => resolveViaVsCode(candidate, ctx),
  }
}

/**
 * Walk candidate → Uri in the order described in plan §2c.
 *
 * Uses `require('vscode')` lazily so the module is importable from
 * Node-only test runners. Returns `null` if no Uri resolves to a
 * readable file under the configured size cap.
 */
async function resolveViaVsCode(
  candidate: string,
  ctx: FileReaderContext
): Promise<{ data: Uint8Array; mimeType: string } | null> {
  if (!isSupportedImagePath(candidate)) return null

  let vscode: VsCodeModule
  try {
    vscode = nodeRequire('vscode') as VsCodeModule
  } catch {
    // No vscode (running in a unit-test process). Fall through to
    // absolute-path best-effort if the candidate looks absolute.
    return resolveAbsoluteFallback(candidate, ctx)
  }

  const candidates: unknown[] = []

  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(candidate)) {
    try {
      candidates.push(vscode.Uri.parse(candidate))
    } catch {
      // unparseable URI — ignore
    }
  } else if (isAbsolutePath(candidate)) {
    candidates.push(vscode.Uri.file(candidate))
  } else {
    // Workspace-relative: try each workspace folder.
    const folders = vscode.workspace.workspaceFolders
    if (folders !== undefined && folders.length > 0) {
      for (const folder of folders) {
        candidates.push(vscode.Uri.joinPath(folder.uri, candidate))
      }
    }
  }

  const fs = vscode.workspace.fs

  for (const uri of candidates) {
    try {
      const stat = await fs.stat(uri)
      // File.Type === 2 in vscode.
      if (stat.type !== 2) continue
      const bytes = await fs.readFile(uri)
      if (ctx.maxBytes > 0 && bytes.byteLength > ctx.maxBytes) {
        getLogger().warn(
          `Skipped path-referenced image (>${(ctx.maxBytes / 1_048_576).toFixed(1)} MB): ${candidate}`
        )
        return null
      }
      return { data: bytes, mimeType: mimeFromExtension(candidate) }
    } catch {
      getLogger().warn(
        `Skipped path-referenced image (not readable): ${candidate}`
      )
      // try next candidate
    }
  }

  // Fallback: absolute path with no vscode in scope.
  return resolveAbsoluteFallback(candidate, ctx)
}

/**
 * Best-effort absolute-path fallback for Node-only environments
 * (tests). Only handles plain absolute filesystem paths — not URIs,
 * not workspace-relative.
 */
async function resolveAbsoluteFallback(
  candidate: string,
  ctx: FileReaderContext
): Promise<{ data: Uint8Array; mimeType: string } | null> {
  if (!isAbsolutePath(candidate)) return null
  const fs = await import('node:fs/promises')
  try {
    const stat = await fs.stat(candidate)
    if (!stat.isFile()) return null
    if (ctx.maxBytes > 0 && stat.size > ctx.maxBytes) {
      getLogger().warn(
        `Skipped path-referenced image (>${(ctx.maxBytes / 1_048_576).toFixed(1)} MB): ${candidate}`
      )
      return null
    }
    const buf = await fs.readFile(candidate)
    return {
      data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      mimeType: mimeFromExtension(candidate),
    }
  } catch {
    return null
  }
}

/** True for OS-absolute paths. Doesn't try to be exhaustive. */
function isAbsolutePath(p: string): boolean {
  if (p.length === 0) return false
  // Windows: \foo, C:\foo, C:/foo (drive-letter back/forward slash)
  if (/^[A-Za-z]:[\\/]/.test(p)) return true
  if (/^[\\/]/.test(p)) return true
  // POSIX: /foo
  if (p.startsWith('/')) return true
  return false
}

/** Guess `image/png|jpeg|gif|webp` from the extension. */
function mimeFromExtension(p: string): string {
  const lower = p.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}
