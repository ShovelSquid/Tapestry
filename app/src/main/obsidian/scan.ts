/**
 * What a Markdown file says about links, tags and frontmatter (D-31, D-33, D-34).
 *
 * Pure, line-based and total: it takes text and returns what that text
 * contains. It never reads the filesystem, never resolves a link to a file and
 * never rewrites the text it was given — resolution lives in `resolve.ts` and
 * the file's bytes stay exactly as `md.text` recorded them.
 *
 * The one rule worth stating twice: **a link's label is the whole literal line
 * it sits in** (D-31). House Party writes relationships as sentences ("Close
 * friends with [[Max]], [[Rody]], and [[Eve]]"), so extracting "close friends"
 * would be Tapestry inventing a claim the file never made. The sentence is
 * recorded; a shorter phrase is Kaelen's to add, under `tapestry.label`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScannedLink {
  /** The link target as written, trimmed: `Sable` from `[[Sable|Sabby]]`. */
  target: string
  /** `![[map.png]]` rather than `[[map.png]]` (D-29). */
  embed: boolean
  /** The whole literal line, minus a trailing CR (D-31). */
  line: string
  /** Zero-based index of that line in the file. */
  lineIndex: number
  /** Index among identical target-and-line pairs, so repeats stay distinct. */
  occurrence: number
}

export interface ScannedFrontmatter {
  /** The block between the `---` fences, verbatim. */
  raw: string
  /** Parsed keys, or null when the block could not be understood. */
  data: Record<string, unknown> | null
}

export interface ScanResult {
  links: ScannedLink[]
  /** Literal `#tag` tokens, in file order, without duplicates (D-33). */
  tags: string[]
  frontmatter: ScannedFrontmatter | null
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * `[[target]]`, `[[target#heading]]`, `[[target|alias]]`, `![[embed]]`.
 *
 * The heading, block and alias parts are matched so they can be discarded: the
 * target is group 2, and `[[Sable#Past]]` and `[[Sable|Sabby]]` both mean
 * Sable. [CITED: obsidian.md/help/links for the disallowed characters]
 */
const LINK_RE = /(!?)\[\[([^\]|#^]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g

/**
 * A `#tag`, requiring at least one character that is not a digit.
 *
 * `#2024` is a heading-ish number rather than a tag, which matches Obsidian's
 * own rule that a tag may not be purely numeric [ASSUMED, research A4].
 */
const TAG_RE = /(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu

/** An opening or closing code fence, allowing up to three spaces of indent. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

/** A frontmatter block larger than this is not parsed, only kept as raw text. */
const MAX_FRONTMATTER_BYTES = 64 * 1024

/** More keys than any real note has; a bound, not a judgment about content. */
const MAX_FRONTMATTER_KEYS = 200

// ---------------------------------------------------------------------------
// Line helpers
// ---------------------------------------------------------------------------

/**
 * The logical line: the raw line minus a trailing CR.
 *
 * `md.text` keeps the CR because it is one of the file's bytes; `md.line` drops
 * it because it is a line ending, not part of what the line says. A CR left in
 * an edge property would show up as a stray control character in the `.tree`
 * file for no reader's benefit.
 */
function withoutCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * Replace inline code spans with spaces, keeping every other character in place.
 *
 * Blanking rather than removing is deliberate: the line handed to the matchers
 * stays the same length as the real line, so nothing downstream has to map an
 * index back through a deletion. Cast.md writes tags as `` `#Guy` `` and means
 * them as code, so a backtick-wrapped tag is not a tag [research A4].
 */
function blankInlineCode(line: string): string {
  const chars = line.split('')
  let i = 0

  while (i < chars.length) {
    if (chars[i] !== '`') {
      i += 1
      continue
    }

    let openLength = 0
    while (i + openLength < chars.length && chars[i + openLength] === '`') openLength += 1

    // Find a closing run of exactly the same length, as CommonMark requires.
    let cursor = i + openLength
    let closeAt = -1
    while (cursor < chars.length) {
      if (chars[cursor] !== '`') {
        cursor += 1
        continue
      }
      let runLength = 0
      while (cursor + runLength < chars.length && chars[cursor + runLength] === '`') runLength += 1
      if (runLength === openLength) {
        closeAt = cursor
        break
      }
      cursor += runLength
    }

    if (closeAt === -1) {
      // An unmatched backtick run is literal text, not the start of a span.
      i += openLength
      continue
    }

    for (let p = i; p < closeAt + openLength; p += 1) chars[p] = ' '
    i = closeAt + openLength
  }

  return chars.join('')
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/**
 * Read a frontmatter block, or say it could not be read.
 *
 * **This is deliberately not a YAML library.** The plan specified
 * `YAML.parse(raw, { maxAliasCount: 50 })` to bound alias expansion
 * (T-02.2-35), but this executor may not run `npm install` — four git
 * worktrees symlink this repository's single `node_modules` and the volume is
 * at 97%. Rather than install, the subset of YAML that frontmatter actually
 * uses is parsed here, and **anchors and aliases are refused outright**. A
 * parser with no alias support cannot expand a billion-laughs bomb at all,
 * which is a stronger mitigation than capping the expansion at 50.
 *
 * Anything it does not understand returns null, and the caller keeps the raw
 * text. That is the honest failure: the note still shows exactly what the file
 * says, and Tapestry simply claims nothing about its keys.
 */
export function parseFrontmatterData(raw: string): Record<string, unknown> | null {
  if (raw.length > MAX_FRONTMATTER_BYTES) return null

  const out: Record<string, unknown> = {}
  let pendingKey: string | null = null
  let pendingList: unknown[] | null = null
  let pendingMap: Record<string, unknown> | null = null

  const flush = (): void => {
    if (pendingKey === null) return
    if (pendingList !== null) out[pendingKey] = pendingList
    else if (pendingMap !== null) out[pendingKey] = pendingMap
    pendingList = null
    pendingMap = null
  }

  for (const rawLine of raw.split('\n')) {
    const line = withoutCarriageReturn(rawLine)
    if (line.trim().length === 0) continue
    // A tab is never valid YAML indentation, and guessing its width would be
    // inventing structure the file did not state.
    if (line.includes('\t')) return null

    const trimmed = line.trim()
    if (trimmed.startsWith('#')) continue

    const indent = line.length - line.trimStart().length

    if (indent > 0) {
      if (pendingKey === null) return null

      if (trimmed === '-' || trimmed.startsWith('- ')) {
        if (pendingMap !== null) return null
        const item = parseScalar(trimmed === '-' ? '' : trimmed.slice(2))
        if (item === UNPARSEABLE) return null
        pendingList = pendingList ?? []
        pendingList.push(item)
        continue
      }

      const nested = /^([^:]+):[ \t]*(.*)$/.exec(trimmed)
      if (!nested || pendingList !== null) return null
      const nestedValue = parseScalar(nested[2])
      if (nestedValue === UNPARSEABLE) return null
      pendingMap = pendingMap ?? {}
      pendingMap[nested[1].trim()] = nestedValue
      continue
    }

    flush()

    const match = /^([^:]+):[ \t]*(.*)$/.exec(line)
    if (!match) return null

    const key = match[1].trim()
    if (key.length === 0) return null
    if (Object.keys(out).length >= MAX_FRONTMATTER_KEYS) return null

    const rest = match[2]
    pendingKey = key

    if (rest.trim().length === 0) {
      // A key whose value is the indented block beneath it.
      out[key] = ''
      continue
    }

    const value = parseScalar(rest)
    if (value === UNPARSEABLE) return null
    out[key] = value
    pendingKey = key
  }

  flush()
  return out
}

/** Returned for a value this parser will not guess at. */
const UNPARSEABLE = Symbol('unparseable')

function parseScalar(text: string): unknown {
  const t = text.trim()
  if (t.length === 0) return ''

  // Anchors, aliases, merge keys and block scalars: refused, never expanded.
  if (t.startsWith('&') || t.startsWith('*') || t.startsWith('|') || t.startsWith('>')) {
    return UNPARSEABLE
  }
  // A flow mapping is structure this parser does not model.
  if (t.startsWith('{')) return UNPARSEABLE

  if (t.startsWith('[')) {
    if (!t.endsWith(']') || t.slice(1, -1).includes('[')) return UNPARSEABLE
    const inner = t.slice(1, -1).trim()
    if (inner.length === 0) return []
    const items: unknown[] = []
    for (const part of inner.split(',')) {
      const item = parseScalar(part)
      if (item === UNPARSEABLE) return UNPARSEABLE
      items.push(item)
    }
    return items
  }

  if (
    (t.startsWith('"') && t.endsWith('"') && t.length > 1) ||
    (t.startsWith("'") && t.endsWith("'") && t.length > 1)
  ) {
    return t.slice(1, -1)
  }

  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null' || t === '~') return null
  if (/^-?\d+$/.test(t) || /^-?\d*\.\d+$/.test(t)) return Number(t)

  return t
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * Everything one Markdown file says about links, tags and frontmatter.
 *
 * Links and tags inside fenced blocks and inline code are ignored, because a
 * note *about* wikilinks would otherwise sprout connections it never meant.
 */
export function scanMarkdown(text: string): ScanResult {
  const rawLines = text.split('\n')
  const lines = rawLines.map(withoutCarriageReturn)

  // --- Frontmatter: only when line 0 is exactly `---` and a closer exists ---
  let frontmatter: ScannedFrontmatter | null = null
  let bodyStart = 0

  if (lines.length > 0 && lines[0] === '---') {
    let close = -1
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i] === '---') {
        close = i
        break
      }
    }
    if (close !== -1) {
      const raw = lines.slice(1, close).join('\n')
      frontmatter = { raw, data: parseFrontmatterData(raw) }
      bodyStart = close + 1
    }
  }

  // --- Body ---
  const links: ScannedLink[] = []
  const tags: string[] = []
  const seenTags = new Set<string>()
  const occurrences = new Map<string, number>()

  let openFence: string | null = null

  for (let index = bodyStart; index < lines.length; index += 1) {
    const line = lines[index]

    const fence = FENCE_RE.exec(line)
    if (fence) {
      const marker = fence[1]
      if (openFence === null) {
        openFence = marker[0].repeat(3)
        continue
      }
      if (marker.startsWith(openFence)) {
        openFence = null
        continue
      }
    }
    if (openFence !== null) continue

    const searchable = blankInlineCode(line)

    LINK_RE.lastIndex = 0
    let linkMatch: RegExpExecArray | null
    while ((linkMatch = LINK_RE.exec(searchable)) !== null) {
      const target = linkMatch[2].trim()
      if (target.length === 0) continue

      // Repeats of the same target on the same literal line stay distinct, so
      // two `[[Sable]]`s in one sentence are two edges rather than one.
      const key = `${target.toLowerCase()}\u0000${line}`
      const occurrence = occurrences.get(key) ?? 0
      occurrences.set(key, occurrence + 1)

      links.push({
        target,
        embed: linkMatch[1] === '!',
        line,
        lineIndex: index,
        occurrence,
      })
    }

    TAG_RE.lastIndex = 0
    let tagMatch: RegExpExecArray | null
    while ((tagMatch = TAG_RE.exec(searchable)) !== null) {
      const token = `#${tagMatch[2]}`
      if (seenTags.has(token)) continue
      seenTags.add(token)
      tags.push(token)
    }
  }

  return { links, tags, frontmatter }
}
