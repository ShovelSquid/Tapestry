/**
 * Which file a `[[link]]` means — or an honest admission that it is not clear.
 *
 * Three answers, and the third is the point: `resolved`, `unresolved`, and
 * `ambiguous`. When two notes share a basename, Obsidian's own tie-break is
 * undocumented [research A4], so Tapestry **refuses to choose**. Guessing would
 * draw a connection the file never stated, and a wrong connection in a record
 * is worse than a visible gap — the gap is a placeholder saying "several notes
 * match", which a person can fix by writing the folder path in the link.
 *
 * Link text never becomes a filesystem path (T-02.2-38): every answer comes
 * from matching against the walked index, so `[[../../etc/passwd]]` resolves to
 * nothing at all rather than to a file.
 */

import type { VaultEntry } from './vault-fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LinkResolution =
  | { kind: 'resolved'; rel: string }
  | { kind: 'unresolved' }
  | { kind: 'ambiguous'; candidates: string[] }

export interface VaultIndex {
  /** Lowercased vault-relative path, with and without `.md`, to real paths. */
  byPath: Map<string, string[]>
  /** Lowercased note basename without `.md`, to real paths. */
  byNoteName: Map<string, string[]>
  /** Lowercased attachment file name including its extension, to real paths. */
  byFileName: Map<string, string[]>
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function add(index: Map<string, string[]>, key: string, rel: string): void {
  const existing = index.get(key)
  if (existing) {
    if (!existing.includes(rel)) existing.push(rel)
    return
  }
  index.set(key, [rel])
}

function fileNameOf(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1)
}

function isMarkdown(rel: string): boolean {
  return /\.md$/i.test(rel)
}

/**
 * Index every file the walk found, so resolution is a lookup rather than a
 * second pass over the disk.
 *
 * Directories contribute nothing: a link names a note or an attachment, never
 * a folder.
 */
export function buildVaultIndex(entries: VaultEntry[]): VaultIndex {
  const index: VaultIndex = {
    byPath: new Map(),
    byNoteName: new Map(),
    byFileName: new Map(),
  }

  for (const entry of entries) {
    if (entry.kind === 'dir') continue

    const rel = entry.rel
    const lower = rel.toLowerCase()
    add(index.byPath, lower, rel)

    if (isMarkdown(rel)) {
      // `Characters/Sable` and `Characters/Sable.md` name the same note.
      add(index.byPath, lower.slice(0, -'.md'.length), rel)
      add(index.byNoteName, fileNameOf(lower).slice(0, -'.md'.length), rel)
      continue
    }

    add(index.byFileName, fileNameOf(lower), rel)
  }

  return index
}

// ---------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------

function answer(matches: string[] | undefined): LinkResolution | null {
  if (!matches || matches.length === 0) return null
  if (matches.length === 1) return { kind: 'resolved', rel: matches[0] }
  return { kind: 'ambiguous', candidates: [...matches].sort() }
}

/**
 * What a link target names, by Obsidian's documented rules and no more.
 *
 * 1. A target containing `/` is a vault-relative path, with or without `.md`.
 * 2. Otherwise a note basename, case-insensitively.
 * 3. Otherwise an attachment, which must be named with its extension —
 *    `[[map.png]]` finds the image, `[[map]]` finds nothing.
 */
export function resolveLink(target: string, index: VaultIndex): LinkResolution {
  const t = target.trim()
  if (t.length === 0) return { kind: 'unresolved' }

  const lower = t.toLowerCase()

  if (t.includes('/')) {
    return (
      answer(index.byPath.get(lower)) ??
      answer(index.byPath.get(`${lower}.md`)) ?? { kind: 'unresolved' }
    )
  }

  return (
    answer(index.byNoteName.get(lower)) ??
    answer(index.byFileName.get(lower)) ?? { kind: 'unresolved' }
  )
}
