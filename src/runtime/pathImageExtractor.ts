/**
 * Pure path extraction for `pathImageResolver.ts`.
 *
 * No `vscode` imports — safe to unit-test in plain Node.
 */

/** A candidate plus its index range in the source text, for splicing. */
export interface CandidateMatch {
  value: string
  /** Inclusive start index in the source string. */
  start: number
  /** Exclusive end index in the source string. */
  end: number
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)(?=[?#"')\]\s]|$)/i

/**
 * Word-boundary-ish regex for a *standalone* file path. We don't try
 * to be RFC-3986 perfect — the goal is "looks like something the user
 * meant as a file", not "parses arbitrary URIs". The path character
 * class excludes whitespace and common delimiters like `,` and `;`.
 *
 * Path captures:
 *   - An optional `file://` URI prefix.
 *   - An optional `#file:` prefix.
 *   - Either:
 *     - A Windows drive-letter path (`C:\foo\bar.png`, `C:/foo/bar.png`).
 *     - A rootless Windows path (`\foo\bar.png`).
 *     - A POSIX absolute path (`/foo/bar.png`).
 *     - A workspace-relative path (`./foo.png`, `foo/bar.png`,
 *       `../foo.png`) — these are *eligible for resolution* against
 *       workspace folders but not standalone-absolute.
 *
 * Ending at any of: whitespace, `"`, `'`, `` ` ``, `,`, `;`, `)`,
 * `]`, `>`, end of string, or before a trailing `?query`/`#fragment`.
 */
const PATH_RE =
  /(?:file:\/\/\S+|#file:[^\s"'`)\]>]*|[A-Za-z]:[\\/][^\s"'`)\]>]*|[\\/][^\s"'`)\]>]*|\.{0,2}[\\/][^\s"'`)\]>]*|[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+(?:\.[A-Za-z0-9]+)?)/g

/**
 * Pull a list of candidate path matches out of a text string, with
 * index ranges for splicing. Filters out:
 *
 *   - Anything whose tail doesn't end in an image extension.
 *   - Anything that is actually a URL (has a scheme like `https://`
 *     before the path — those are skipped because we can't open them).
 *   - Duplicates with the same value & start.
 *
 * The order of returned candidates matches the order in the source
 * string (the regex is in `g` mode and we walk left-to-right).
 */
export function extractCandidatePaths(text: string): CandidateMatch[] {
  if (!text || text.length === 0) return []
  const out: CandidateMatch[] = []
  // Reset lastIndex defensively — the regex has the `g` flag and is
  // shared via the module-cache.
  PATH_RE.lastIndex = 0

  let m: RegExpExecArray | null
  while ((m = PATH_RE.exec(text)) !== null) {
    const value = m[0]
    if (!value || value.length === 0) continue
    const start = m.index
    const end = start + value.length

    // Skip obvious URL prefixes (http(s)://, ftp://, etc.) — the
    // `file://` scheme is the only one we want.
    const before = text.slice(Math.max(0, start - 8), start)
    if (/https?|ftp|wss?$/i.test(before)) continue

    if (!isSupportedImagePath(value)) continue

    out.push({ value, start, end })
  }

  return out
}

/**
 * True for paths whose tail ends in a supported image extension.
 * Case-insensitive. Also accepts trailing `?query` / `#fragment`
 * characters since the regex stopped at them.
 */
export function isSupportedImagePath(p: string): boolean {
  if (!p || typeof p !== 'string') return false
  // Strip trailing delimiters the regex may have left behind.
  const trimmed = p.replace(/[.,;:!?)\]'"`\s]+$/, '')
  // Defensive: if the candidate is just `#file:` with nothing after,
  // bail.
  if (trimmed.length < 5) return false
  return IMAGE_EXT_RE.test(trimmed)
}
