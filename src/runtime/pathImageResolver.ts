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
  /**
   * Absolute filesystem path used to resolve workspace-relative
   * candidates (e.g. `docs/foo.png`) when no `vscode.workspace.workspaceFolders`
   * is exposed. Defaults to the empty string, which makes the
   * resolver skip the cwd fallback (preserves the prior behavior in
   * tests that pass synthetic readers).
   */
  readonly cwd?: string
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
 *
 * `cwd` is forwarded to the reader so workspace-relative candidates
 * like `docs/foo.png` resolve against `process.cwd()` when no
 * `vscode.workspace.workspaceFolders` is exposed (e.g. when the
 * provider runs in a workspace-less chat window).
 */
export async function inlinePathImages(
  vscodeMessages: readonly LlmMessage[],
  options: PathImageOptions,
  reader?: FileReader,
  cancellationToken?: { isCancellationRequested: boolean },
  cwd?: string
): Promise<LlmMessage[]> {
  if (!options.enabled) return vscodeMessages.slice()
  if (vscodeMessages.length === 0) return vscodeMessages.slice()

  const r = reader ?? getDefaultReader()
  // If the caller didn't give us a cwd but the production path did
  // (via `getDefaultReader().resolve` injecting it), the reader
  // already uses it. Otherwise fall back to `process.cwd()` for the
  // Node-only environments so relative paths resolve in tests too.
  const effectiveCwd = cwd ?? process.cwd()
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
        cwd: effectiveCwd,
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
  } else if (candidate.startsWith('#file:')) {
    // VS Code's chat `#file:` reference syntax. Two forms:
    //
    //   `#file:docs/foo.png`   (bare, workspace-relative)
    //   `#file:///c:/abs/path` (URI — equivalent to `file:///…`)
    //
    // Without stripping the prefix, fs.stat is asked for a path
    // that literally contains `#file:` and always returns ENOENT —
    // the prefix is just chat-side markup, not a filesystem
    // component. (2026-07-03 fix: the prefix slipped through every
    // branch of this if/else ladder because it isn't a `://` URI,
    // isn't absolute, and isn't a bare relative path — it ended up
    // in the workspace-relative branch where `joinPath` produced a
    // nonsense filesystem path.)
    const stripped = stripFilePrefix(candidate)
    if (stripped === null) {
      getLogger().warn(
        `Skipped path-referenced image (malformed #file: reference): ${candidate}`
      )
      return null
    }
    if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(stripped)) {
      // URI form (`#file:///abs/path` → `file:///abs/path`):
      // hand to Uri.parse like any other file:// URL. Don't also
      // try the workspace-relative join — `stripped` is a URI, not
      // a path; joinPath on it would produce nonsense like
      // `<folder>/file:///c:/abs/path`.
      try {
        candidates.push(vscode.Uri.parse(stripped))
      } catch {
        // unparseable — fall through to the bare-form branches
        // below just in case (they'll silently fail ENOENT).
      }
    } else {
      // Bare form (`#file:<rest>`): resolve like a workspace-
      // relative path, then fall back to cwd.
      const folders = vscode.workspace.workspaceFolders
      if (folders !== undefined && folders.length > 0) {
        for (const folder of folders) {
          candidates.push(vscode.Uri.joinPath(folder.uri, stripped))
        }
      }
      if (ctx.cwd && ctx.cwd.length > 0) {
        candidates.push(vscode.Uri.file(joinPath(ctx.cwd, stripped)))
      }
    }
  } else {
    // Workspace-relative: try each workspace folder first…
    const folders = vscode.workspace.workspaceFolders
    if (folders !== undefined && folders.length > 0) {
      for (const folder of folders) {
        candidates.push(vscode.Uri.joinPath(folder.uri, candidate))
      }
    }
    // …then fall back to the supplied cwd. VS Code's
    // language-model chat provider often runs without a workspace
    // folder visible (e.g. when the user opened Copilot Chat from a
    // "no folder" workspace), in which case the only sensible
    // resolution base for a bare relative path is cwd. Without this
    // fallback, the path silently fails — which is what we observed
    // for `test-resources/screenshot.png` while `C:\full\path.png`
    // worked because it took the absolute branch above.
    if (ctx.cwd && ctx.cwd.length > 0) {
      candidates.push(vscode.Uri.file(joinPath(ctx.cwd, candidate)))
    }
  }

  const fs = vscode.workspace.fs
  let triedAny = false

  for (const uri of candidates) {
    triedAny = true
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
      // Try the next candidate (next workspace folder, or the cwd
      // fallback). Only emit the "not readable" line once we've
      // exhausted all candidates so the log doesn't get noisy when
      // both a workspace folder and cwd are tried.
      continue
    }
  }

  if (triedAny) {
    // Don't spam the log on every ENOENT — only when ALL candidates
    // failed. This makes it obvious why a relative path didn't
    // inline when the user expects it to.
    getLogger().warn(
      `Skipped path-referenced image (not readable): ${candidate}`
    )
    return null
  }

  // No workspace folders AND no cwd → nothing to try.
  if (!ctx.cwd || ctx.cwd.length === 0) {
    getLogger().warn(
      `Skipped path-referenced image (no workspace folder or cwd available): ${candidate}`
    )
    return null
  }

  // Fallback: absolute path with no vscode in scope.
  return resolveAbsoluteFallback(candidate, ctx)
}

/**
 * Best-effort fallback for Node-only environments (tests) and for
 * the production `vscode`-less extension context. Handles absolute
 * filesystem paths directly, and falls back to a `cwd + candidate`
 * join for relative paths so tests/dev environments work the same
 * way as production.
 */
async function resolveAbsoluteFallback(
  candidate: string,
  ctx: FileReaderContext
): Promise<{ data: Uint8Array; mimeType: string } | null> {
  const fs = await import('node:fs/promises')
  // Strip VS Code's chat-side `#file:` markup before doing any
  // filesystem work — it's not a path component, and asking Node's
  // `fs` to stat a string containing `#file:` always returns ENOENT.
  let working = candidate
  if (working.startsWith('#file:')) {
    const stripped = stripFilePrefix(working)
    if (stripped === null) {
      getLogger().warn(
        `Skipped path-referenced image (malformed #file: reference): ${candidate}`
      )
      return null
    }
    working = stripped
  }
  // If the URI form survived stripping (`file:///abs/path`), decode
  // it to a filesystem path. Node's `fs` treats a literal
  // `file:///c:/foo` as a relative path (`<cwd>/file:/c:/foo`),
  // which is almost certainly not what the user meant. The
  // decode mirrors what `vscode.Uri.parse` would do in the
  // production-vscode branch above.
  if (/^file:\/\/\//i.test(working)) {
    working = working
      .replace(/^file:\/\/\//i, '')
      .replace(/^\/([A-Za-z]:)\//, '$1\\')
    working = working.replace(/\//g, '\\')
  }
  // Build an ordered list of (path, source) pairs. Each entry is a
  // filesystem path to try; the source helps the caller log which
  // resolution base actually worked when reading succeeds.
  const paths: string[] = []
  if (isAbsolutePath(working)) {
    paths.push(working)
  } else if (ctx.cwd && ctx.cwd.length > 0) {
    paths.push(joinPath(ctx.cwd, working))
  } else {
    return null
  }
  // Also try the literal (already-stripped) candidate as a last
  // resort — some workspaces (and process.cwd()) yield the right
  // answer without an explicit cwd join when the process happens
  // to be at the workspace root.
  if (!paths.includes(working)) paths.push(working)

  for (const p of paths) {
    try {
      const stat = await fs.stat(p)
      if (!stat.isFile()) continue
      if (ctx.maxBytes > 0 && stat.size > ctx.maxBytes) {
        getLogger().warn(
          `Skipped path-referenced image (>${(ctx.maxBytes / 1_048_576).toFixed(1)} MB): ${candidate}`
        )
        return null
      }
      const buf = await fs.readFile(p)
      return {
        data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        mimeType: mimeFromExtension(candidate),
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Strip the VS Code chat `#file:` reference prefix and return the
 * path remainder. Accepts both bare (`#file:docs/foo.png`) and
 * URI-style (`#file:///c:/Users/me/pics/cat.png`) forms. Returns
 * `null` if the candidate is just `#file:` with nothing after it.
 *
 * For the bare form (`#file:<rest>`), `<rest>` is returned as a
 * workspace-relative path string. For the URI form (`#file://…`),
 * the leading `#file://` is replaced with `file://` so the caller
 * can hand the result to `Uri.parse` like any other `file://`
 * reference — VS Code's chat emits `#file://` to disambiguate
 * inside chat markup, but the underlying URI is the same.
 *
 * Lives at module scope (not nested in `resolveViaVsCode`) so the
 * Node-only fallback path in `resolveAbsoluteFallback` can reuse it
 * without re-deriving the regex.
 */
function stripFilePrefix(candidate: string): string | null {
  if (!candidate.startsWith('#file:')) return null
  const rest = candidate.slice('#file:'.length)
  if (rest.length === 0) return null
  // URI form: `#file://...` → `file://...`. Empty between
  // `file://` and the start of the path is not valid (would be
  // `#file:///`); if that slips through, treat as malformed.
  if (rest.startsWith('//')) {
    return rest.startsWith('///') ? `file://${rest.slice(2)}` : null
  }
  // Bare form. Strip a leading `./` to keep the workspace-relative
  // join logic (and the cwd fallback) happy — `#file:./docs/foo.png`
  // is a common shape that should resolve identically to
  // `#file:docs/foo.png`.
  return rest.replace(/^\.\//, '')
}

/**
 * Join a cwd and a (possibly `./`-prefixed) candidate, normalizing
 * the result. Mirrors Node's `path.join` so we don't have to depend
 * on `path` being loadable in the `vscode` branch's tests.
 */
function joinPath(cwd: string, candidate: string): string {
  // Strip leading `./` segments — they confuse Node's path.join in
  // some edge cases on Windows when the cwd ends in a backslash.
  const rel = candidate.replace(/^\.\/(?:\\|\/)?/, '')
  if (rel.length === 0) return cwd
  // Be tolerant of forward and backward slashes in `rel` — VS Code
  // hands us POSIX-style paths even on Windows.
  const normalizedRel = cwd.includes('\\')
    ? rel.replace(/\//g, '\\')
    : rel.replace(/\\/g, '/')
  const sep = cwd.includes('\\') ? '\\' : '/'
  if (cwd.endsWith('\\') || cwd.endsWith('/')) return `${cwd}${normalizedRel}`
  return `${cwd}${sep}${normalizedRel}`
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
