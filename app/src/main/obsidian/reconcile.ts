/**
 * The desired state of a vault, and the difference between it and its tree.
 *
 * This module is pure and knows nothing about the kernel, Electron or the
 * clock: it takes what the files say and what the tree currently records, and
 * returns the operations that would make the second match the first. That is
 * what makes the mirror testable without opening a world, and it is why the
 * hard question — "does this tree still say what the vault says?" — has one
 * answer computed in one place.
 *
 * Plan 08 extends the same module with links, tags, frontmatter, file notes
 * and placeholders. The exported names here are stable so that extension is
 * additive rather than a rewrite.
 */

import type { EdgeData, NodeData, OpObject } from '../kernel-bridge'
import { decodeMarkdown, readVaultBytes, type VaultEntry } from './vault-fs'
import {
  MD_PATH,
  MD_SHA256,
  MD_TEXT,
  VAULT_FOLDER_TYPE,
  VAULT_NOTE_TYPE,
} from './shapes'

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface VaultNoteModel {
  /** The file's text, exactly (D-12). */
  text: string
  sha256: string
}

export interface VaultFileModel {
  /** Extension without the dot, lowercase; empty for a file that has none. */
  ext: string
  bytes: number
  sha256?: string
  /** Why this is a file note rather than a note (D-29, T-02.2-34). */
  unreadable?: string
}

/**
 * What the vault currently contains, keyed by vault-relative path.
 *
 * `files` is populated here but not yet turned into nodes: this plan mirrors
 * notes and folders, and Plan 08 gives the files their own cards. Building the
 * map now means the deletion pass already knows a file's path is accounted for
 * rather than missing, so adding those nodes later changes no other behaviour.
 */
export interface VaultModel {
  notes: Map<string, VaultNoteModel>
  folders: Set<string>
  files: Map<string, VaultFileModel>
}

/** Extension without the dot, lowercase. `map.png` → `png`. */
function extensionOf(rel: string): string {
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Read every entry and decide what it is.
 *
 * A `.md` that decodes is a note. A `.md` that does not — invalid UTF-8, a NUL
 * byte, a line past the kernel's limit, or simply too large to read — becomes a
 * file entry carrying the reason in words. It is never transcoded: bytes that
 * were repaired to fit would be recorded as what the file says, and they are
 * not (D-10).
 */
export async function buildVaultModel(
  root: string,
  entries: VaultEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<VaultModel> {
  const model: VaultModel = { notes: new Map(), folders: new Set(), files: new Map() }

  const readable = entries.filter((entry) => entry.kind !== 'dir')
  let done = 0

  for (const entry of entries) {
    if (entry.kind === 'dir') {
      model.folders.add(entry.rel)
      continue
    }

    done += 1
    onProgress?.(done, readable.length)

    if (entry.kind === 'symlink') {
      // Recorded, never followed: this is the whole of T-02.2-33.
      model.files.set(entry.rel, {
        ext: extensionOf(entry.rel),
        bytes: entry.size,
        unreadable: 'symbolic link not followed',
      })
      continue
    }

    let read
    try {
      read = readVaultBytes(root, entry.rel)
    } catch (err) {
      model.files.set(entry.rel, {
        ext: extensionOf(entry.rel),
        bytes: entry.size,
        unreadable: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    if ('tooLarge' in read) {
      model.files.set(entry.rel, {
        ext: extensionOf(entry.rel),
        bytes: read.size,
        unreadable: `is larger than 16 MiB (${read.size} bytes)`,
      })
      continue
    }

    if (entry.kind === 'file') {
      model.files.set(entry.rel, {
        ext: extensionOf(entry.rel),
        bytes: read.bytes.length,
        sha256: read.sha256,
      })
      continue
    }

    const decoded = decodeMarkdown(read.bytes)
    if (!decoded.ok) {
      model.files.set(entry.rel, {
        ext: extensionOf(entry.rel),
        bytes: read.bytes.length,
        sha256: read.sha256,
        unreadable: decoded.reason,
      })
      continue
    }

    model.notes.set(entry.rel, { text: decoded.text, sha256: read.sha256 })
  }

  return model
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Card width, plus the gap between columns. */
const COLUMN_STEP = 280 + 24
/** Assumed card height, plus the gap between rows. */
const ROW_STEP = 200 + 24
const COLUMNS = 3
/** Space between one folder group and the next. */
const GROUP_GAP = 32
/** Room above a group's first row for its label (D-26). */
const GROUP_LABEL_HEIGHT = 40

export interface Point {
  x: number
  y: number
}

function rowsFor(count: number): number {
  return Math.ceil(count / COLUMNS)
}

function parentOf(rel: string): string {
  const cut = rel.lastIndexOf('/')
  return cut === -1 ? '' : rel.slice(0, cut)
}

function placeGrid(out: Map<string, Point>, rels: string[], originY: number): void {
  rels.forEach((rel, index) => {
    out.set(rel, {
      x: (index % COLUMNS) * COLUMN_STEP,
      y: originY + Math.floor(index / COLUMNS) * ROW_STEP,
    })
  })
}

/**
 * Where every note and folder sits inside the vault frame.
 *
 * Pure and total: the same vault lays out the same way on every machine and on
 * every catch-up, so a note that has not moved is never rewritten with a new
 * position. Once Kaelen drags a card the stored position wins — this only ever
 * decides where something appears the first time.
 *
 * Root notes come first, then each folder as a group in path order, which puts
 * a nested folder directly after its parent's notes.
 */
export function layoutVault(model: VaultModel): Map<string, Point> {
  const positions = new Map<string, Point>()

  const noteRels = [...model.notes.keys()].sort()
  const rootNotes = noteRels.filter((rel) => !rel.includes('/'))
  placeGrid(positions, rootNotes, 0)

  let cursor = rowsFor(rootNotes.length) * ROW_STEP

  for (const folder of [...model.folders].sort()) {
    if (cursor > 0) cursor += GROUP_GAP

    positions.set(folder, { x: 0, y: cursor })

    const inside = noteRels.filter((rel) => parentOf(rel) === folder)
    placeGrid(positions, inside, cursor + GROUP_LABEL_HEIGHT)

    cursor += GROUP_LABEL_HEIGHT + rowsFor(inside.length) * ROW_STEP
  }

  return positions
}

// ---------------------------------------------------------------------------
// Reconciling
// ---------------------------------------------------------------------------

/**
 * How much `md.text` may ride in one commit.
 *
 * A record may not exceed 64 MiB (FORMAT.md "Limits"), and a first import of a
 * large vault would otherwise put every file's full text in one record
 * (research Pitfall 6). Half the limit leaves room for the ops themselves.
 */
export const MAX_COMMIT_TEXT_BYTES = 32 * 1024 * 1024

export interface ReconcileSummary {
  created: string[]
  modified: string[]
  deleted: string[]
  /**
   * Always empty in this plan. Pairing a deletion with a creation of equal
   * hash is D-24, in Plan 08; reporting a rename before it is detected would
   * be a guess, and the point of this record is that it never guesses.
   */
  renamed: Array<[string, string]>
}

export interface ReconcilePlan {
  /** One array per commit. Empty when the tree already says what the vault says. */
  ops: OpObject[][]
  summary: ReconcileSummary
}

export interface TreeGraph {
  nodes: NodeData[]
  edges: EdgeData[]
}

function pathOf(node: NodeData): string | null {
  const prop = node.props[MD_PATH]
  return prop && typeof prop.value === 'string' ? prop.value : null
}

function hashOf(node: NodeData): string | null {
  const prop = node.props[MD_SHA256]
  return prop && typeof prop.value === 'string' ? prop.value : null
}

/** One indivisible change, with the text weight that decides its chunk. */
interface ReconcileUnit {
  ops: OpObject[]
  bytes: number
}

/**
 * The operations that would make `tree` say what `model` says.
 *
 * Nothing is emitted for a note whose hash already matches, which is what
 * keeps a catch-up over an unchanged vault free (and what stops Tapestry's own
 * writes echoing back as observations — research Pitfall 3).
 */
export function planReconcile(tree: TreeGraph, model: VaultModel): ReconcilePlan {
  const positions = layoutVault(model)

  const byPath = new Map<string, NodeData>()
  for (const node of tree.nodes) {
    const path = pathOf(node)
    if (path !== null) byPath.set(path, node)
  }

  const created: string[] = []
  const modified: string[] = []
  const deleted: string[] = []
  const units: ReconcileUnit[] = []

  // Folders first, so a reader of the journal meets the group before its notes.
  for (const folder of [...model.folders].sort()) {
    if (byPath.has(folder)) continue
    const at = positions.get(folder) ?? { x: 0, y: 0 }
    units.push({
      bytes: 0,
      ops: [
        {
          op: 'createNode',
          type: VAULT_FOLDER_TYPE,
          props: {
            [MD_PATH]: { type: 'text', value: folder },
            'position.x': { type: 'real', value: at.x },
            'position.y': { type: 'real', value: at.y },
          },
        },
      ],
    })
    created.push(folder)
  }

  for (const rel of [...model.notes.keys()].sort()) {
    const note = model.notes.get(rel)!
    const bytes = Buffer.byteLength(note.text, 'utf-8')
    const existing = byPath.get(rel)

    if (!existing) {
      const at = positions.get(rel) ?? { x: 0, y: 0 }
      units.push({
        bytes,
        ops: [
          {
            op: 'createNode',
            type: VAULT_NOTE_TYPE,
            props: {
              [MD_PATH]: { type: 'text', value: rel },
              [MD_TEXT]: { type: 'text', value: note.text },
              [MD_SHA256]: { type: 'text', value: note.sha256 },
              'position.x': { type: 'real', value: at.x },
              'position.y': { type: 'real', value: at.y },
              width: { type: 'real', value: 280 },
            },
          },
        ],
      })
      created.push(rel)
      continue
    }

    if (hashOf(existing) === note.sha256) continue

    units.push({
      bytes,
      ops: [
        { op: 'setProperty', target: existing.id, key: MD_TEXT, type: 'text', value: note.text },
        {
          op: 'setProperty',
          target: existing.id,
          key: MD_SHA256,
          type: 'text',
          value: note.sha256,
        },
      ],
    })
    modified.push(rel)
  }

  for (const [path, node] of byPath) {
    if (model.notes.has(path)) continue
    if (model.folders.has(path)) continue
    // A file entry has no node yet in this plan, but once Plan 08 gives it one
    // this is what stops the file's own card being deleted every catch-up.
    if (model.files.has(path)) continue

    units.push({ bytes: 0, ops: [{ op: 'deleteNode', id: node.id }] })
    deleted.push(path)
  }

  const ops: OpObject[][] = []
  let chunk: OpObject[] = []
  let chunkBytes = 0
  for (const unit of units) {
    if (chunk.length > 0 && chunkBytes + unit.bytes > MAX_COMMIT_TEXT_BYTES) {
      ops.push(chunk)
      chunk = []
      chunkBytes = 0
    }
    chunk.push(...unit.ops)
    chunkBytes += unit.bytes
  }
  if (chunk.length > 0) ops.push(chunk)

  return { ops, summary: { created, modified, deleted, renamed: [] } }
}
