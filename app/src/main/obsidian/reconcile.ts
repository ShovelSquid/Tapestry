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
 * Plan 07 mirrored each file's text. Plan 08 adds everything else the files
 * already say: `[[links]]` as connections labeled with their literal line
 * (D-31), `![[embeds]]` (D-29), `#tags` and frontmatter as readable properties
 * (D-33), file notes for everything that is not readable Markdown (D-29), and
 * placeholders for links to notes that do not exist yet (D-34). Nothing here
 * writes to a `.md` file; every value it records is read from one.
 */

import type { EdgeData, NodeData, OpObject } from '../kernel-bridge'
import { decodeMarkdown, readVaultBytes, type VaultEntry } from './vault-fs'
import { buildVaultIndex, resolveLink, type LinkResolution } from './resolve'
import { scanMarkdown, type ScannedFrontmatter } from './scan'
import {
  EMBED_LABEL,
  MD_AMBIGUOUS,
  MD_BYTES,
  MD_EXT,
  MD_FM_PREFIX,
  MD_FRONTMATTER,
  MD_LINE,
  MD_LINK,
  MD_OCCURRENCE,
  MD_PATH,
  MD_SHA256,
  MD_TAGS,
  MD_TEXT,
  MD_UNREADABLE,
  VAULT_FILE_TYPE,
  VAULT_FOLDER_TYPE,
  VAULT_NOTE_TYPE,
  VAULT_PLACEHOLDER_TYPE,
  WIKILINK_LABEL,
} from './shapes'

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** One `[[link]]`, with what it turned out to mean. */
export interface ResolvedLink {
  target: string
  embed: boolean
  /** The whole literal line the link sits in (D-31). */
  line: string
  occurrence: number
  resolution: LinkResolution
}

export interface VaultNoteModel {
  /** The file's text, exactly (D-12). */
  text: string
  sha256: string
  /** Literal `#tag` tokens in file order (D-33). */
  tags: string[]
  frontmatter: ScannedFrontmatter | null
  links: ResolvedLink[]
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
 * `linkTargets` records what every distinct link target resolved to, which is
 * how a placeholder learns that its note now exists: the note then takes the
 * placeholder's position rather than appearing somewhere else on the canvas.
 */
export interface VaultModel {
  notes: Map<string, VaultNoteModel>
  folders: Set<string>
  files: Map<string, VaultFileModel>
  /** Lowercased link target to what it resolved to. */
  linkTargets: Map<string, LinkResolution>
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
 *
 * Links are resolved in a second pass, once every path is known: a link to a
 * note later in the walk must resolve, so nothing can be decided until the
 * whole index exists.
 */
export async function buildVaultModel(
  root: string,
  entries: VaultEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<VaultModel> {
  const model: VaultModel = {
    notes: new Map(),
    folders: new Set(),
    files: new Map(),
    linkTargets: new Map(),
  }

  const readable = entries.filter((entry) => entry.kind !== 'dir')
  const texts = new Map<string, { text: string; sha256: string }>()
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

    texts.set(entry.rel, { text: decoded.text, sha256: read.sha256 })
  }

  // --- Second pass: what the notes say about each other --------------------
  const index = buildVaultIndex(entries)

  for (const [rel, read] of texts) {
    const scan = scanMarkdown(read.text)

    const links: ResolvedLink[] = scan.links.map((link) => {
      const key = link.target.toLowerCase()
      let resolution = model.linkTargets.get(key)
      if (!resolution) {
        resolution = resolveLink(link.target, index)
        model.linkTargets.set(key, resolution)
      }
      return {
        target: link.target,
        embed: link.embed,
        line: link.line,
        occurrence: link.occurrence,
        resolution,
      }
    })

    model.notes.set(rel, {
      text: read.text,
      sha256: read.sha256,
      tags: scan.tags,
      frontmatter: scan.frontmatter,
      links,
    })
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
/** A card's width, and the offset a placeholder sits at beside its note. */
const CARD_WIDTH = 280
/** UI-SPEC: a placeholder sits 48px right of the linking note's right edge. */
const PLACEHOLDER_GAP = 48

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
 * Where every note, file and folder sits inside the vault frame.
 *
 * Pure and total: the same vault lays out the same way on every machine and on
 * every catch-up, so a note that has not moved is never rewritten with a new
 * position. Once Kaelen drags a card the stored position wins — this only ever
 * decides where something appears the first time.
 *
 * Root items come first, then each folder as a group in path order, which puts
 * a nested folder directly after its parent's notes. Files are laid out beside
 * the notes they sit next to on disk, because that is where a person looking
 * for them expects them to be (D-29).
 */
export function layoutVault(model: VaultModel): Map<string, Point> {
  const positions = new Map<string, Point>()

  const itemRels = [...model.notes.keys(), ...model.files.keys()].sort()
  const rootItems = itemRels.filter((rel) => !rel.includes('/'))
  placeGrid(positions, rootItems, 0)

  let cursor = rowsFor(rootItems.length) * ROW_STEP

  for (const folder of [...model.folders].sort()) {
    if (cursor > 0) cursor += GROUP_GAP

    positions.set(folder, { x: 0, y: cursor })

    const inside = itemRels.filter((rel) => parentOf(rel) === folder)
    placeGrid(positions, inside, cursor + GROUP_LABEL_HEIGHT)

    cursor += GROUP_LABEL_HEIGHT + rowsFor(inside.length) * ROW_STEP
  }

  return positions
}

// ---------------------------------------------------------------------------
// Derived properties (D-33)
// ---------------------------------------------------------------------------

/**
 * A frontmatter key is only mirrored when it is already a legal property key.
 *
 * `written by: the sample` keeps its value in `md.frontmatter` and gets no
 * `md.fm.*` entry, because inventing `md.fm.written_by` would record a key the
 * file does not contain (FORMAT.md "Keys and tokens").
 */
const FM_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/

type PropValue = { type: string; value: string | number | boolean }

function frontmatterText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Everything a note's `md.*` derived keys should say right now.
 *
 * Returned as a plain map so the create path and the update path share one
 * definition: a property that exists here is set, and one that exists on the
 * node but not here is unset.
 */
function derivedNoteProps(note: VaultNoteModel): Map<string, PropValue> {
  const props = new Map<string, PropValue>()

  if (note.tags.length > 0) {
    props.set(MD_TAGS, { type: 'text', value: note.tags.join(' ') })
  }

  if (note.frontmatter) {
    props.set(MD_FRONTMATTER, { type: 'text', value: note.frontmatter.raw })

    const data = note.frontmatter.data
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        if (!FM_KEY_RE.test(key)) continue
        props.set(`${MD_FM_PREFIX}${key}`, { type: 'text', value: frontmatterText(value) })
      }
    }
  }

  return props
}

/** Every `md.*` key this module owns on a note, as currently stored. */
function storedDerivedKeys(node: NodeData): string[] {
  return Object.keys(node.props).filter(
    (key) => key === MD_TAGS || key === MD_FRONTMATTER || key.startsWith(MD_FM_PREFIX),
  )
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
   * Always empty. Pairing a deletion with a creation of equal hash is D-24,
   * which needs the live watcher's inode information (Plan 10); reporting a
   * rename before it is detected would be a guess, and the point of this
   * record is that it never guesses.
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

/** The ids the kernel will hand the next createNode and createEdge. */
export interface NextIds {
  node: string
  edge: string
}

function pathOf(node: NodeData): string | null {
  const prop = node.props[MD_PATH]
  return prop && typeof prop.value === 'string' ? prop.value : null
}

function stringProp(node: NodeData | EdgeData, key: string): string | null {
  const prop = node.props[key]
  return prop && typeof prop.value === 'string' ? prop.value : null
}

function numberProp(node: NodeData | EdgeData, key: string, fallback: number): number {
  const prop = node.props[key]
  return prop && typeof prop.value === 'number' ? prop.value : fallback
}

/** One indivisible change, with the text weight that decides its chunk. */
interface ReconcileUnit {
  ops: OpObject[]
  bytes: number
}

/** How a placeholder node is named in an edge key. */
function placeholderKey(target: string): string {
  return `placeholder:${target.toLowerCase()}`
}

/** One desired connection, before it is matched against what exists. */
interface DesiredEdge {
  fromRel: string
  label: string
  targetKey: string
  line: string
  occurrence: number
}

function edgeKey(
  fromKey: string,
  label: string,
  targetKey: string,
  line: string,
  occurrence: number,
): string {
  return [fromKey, label, targetKey, line, String(occurrence)].join('\u0000')
}

/**
 * The operations that would make `tree` say what `model` says.
 *
 * Nothing is emitted for a note whose hash already matches, which is what
 * keeps a catch-up over an unchanged vault free (and what stops Tapestry's own
 * writes echoing back as observations — research Pitfall 3).
 *
 * `nextIds` lets a connection be written in the same commit as the note it
 * points at. Without it the nodes are still created and the edges simply wait
 * for the next catch-up, when both endpoints exist and have real ids.
 */
export function planReconcile(
  tree: TreeGraph,
  model: VaultModel,
  nextIds?: NextIds,
): ReconcilePlan {
  const positions = layoutVault(model)

  const byPath = new Map<string, NodeData>()
  const placeholdersByKey = new Map<string, NodeData>()
  for (const node of tree.nodes) {
    const path = pathOf(node)
    if (path !== null) {
      byPath.set(path, node)
      continue
    }
    if (node.type === VAULT_PLACEHOLDER_TYPE) {
      const link = stringProp(node, MD_LINK)
      if (link !== null) placeholdersByKey.set(placeholderKey(link), node)
    }
  }

  const created: string[] = []
  const modified: string[] = []
  const deleted: string[] = []
  const units: ReconcileUnit[] = []

  // --- Predicted ids -------------------------------------------------------
  // Claimed in the exact order createNode ops are emitted, because that is the
  // order the kernel assigns them in.
  let nodeCounter = nextIds ? Number.parseInt(nextIds.node.slice(1), 10) : Number.NaN
  const idForPath = new Map<string, string>()
  const idForPlaceholder = new Map<string, string>()

  function claimNodeId(): string | null {
    if (!Number.isFinite(nodeCounter)) return null
    const id = `n${nodeCounter}`
    nodeCounter += 1
    return id
  }

  // --- What the vault wants ------------------------------------------------
  interface DesiredPlaceholder {
    link: string
    ambiguous: boolean
    anchorRel: string
  }

  const desiredPlaceholders = new Map<string, DesiredPlaceholder>()
  const desiredEdges: DesiredEdge[] = []

  for (const rel of [...model.notes.keys()].sort()) {
    const note = model.notes.get(rel)!

    for (const link of note.links) {
      if (link.resolution.kind === 'resolved') {
        desiredEdges.push({
          fromRel: rel,
          label: link.embed ? EMBED_LABEL : WIKILINK_LABEL,
          targetKey: link.resolution.rel,
          line: link.line,
          occurrence: link.occurrence,
        })
        continue
      }

      const key = placeholderKey(link.target)
      if (!desiredPlaceholders.has(key)) {
        desiredPlaceholders.set(key, {
          link: link.target,
          ambiguous: link.resolution.kind === 'ambiguous',
          anchorRel: rel,
        })
      }

      // An ambiguous link gets a placeholder that explains itself, and no edge
      // at all: connecting it to either candidate would be the guess D-34 and
      // the UI-SPEC both forbid ("never connected to either candidate").
      if (link.resolution.kind === 'ambiguous') continue

      desiredEdges.push({
        fromRel: rel,
        label: link.embed ? EMBED_LABEL : WIKILINK_LABEL,
        targetKey: key,
        line: link.line,
        occurrence: link.occurrence,
      })
    }
  }

  // --- Where a note sits ---------------------------------------------------
  function positionOf(rel: string): Point {
    const existing = byPath.get(rel)
    if (existing) {
      return {
        x: numberProp(existing, 'position.x', 0),
        y: numberProp(existing, 'position.y', 0),
      }
    }
    return positions.get(rel) ?? { x: 0, y: 0 }
  }

  /**
   * A note that replaces a placeholder appears exactly where the placeholder
   * was, so typing into a placeholder does not make the card jump.
   */
  function inheritedPosition(rel: string): Point | null {
    for (const [key, node] of placeholdersByKey) {
      if (desiredPlaceholders.has(key)) continue
      const resolution = model.linkTargets.get(key.slice('placeholder:'.length))
      if (resolution?.kind === 'resolved' && resolution.rel === rel) {
        return {
          x: numberProp(node, 'position.x', 0),
          y: numberProp(node, 'position.y', 0),
        }
      }
    }
    return null
  }

  // --- 1. Folders ----------------------------------------------------------
  // First, so a reader of the journal meets the group before its notes.
  for (const folder of [...model.folders].sort()) {
    if (byPath.has(folder)) continue
    const at = positions.get(folder) ?? { x: 0, y: 0 }
    const id = claimNodeId()
    if (id) idForPath.set(folder, id)
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

  // --- 2. Notes ------------------------------------------------------------
  for (const rel of [...model.notes.keys()].sort()) {
    const note = model.notes.get(rel)!
    const bytes = Buffer.byteLength(note.text, 'utf-8')
    const existing = byPath.get(rel)
    const derived = derivedNoteProps(note)

    if (!existing) {
      const at = inheritedPosition(rel) ?? positions.get(rel) ?? { x: 0, y: 0 }
      const props: Record<string, PropValue> = {
        [MD_PATH]: { type: 'text', value: rel },
        [MD_TEXT]: { type: 'text', value: note.text },
        [MD_SHA256]: { type: 'text', value: note.sha256 },
        'position.x': { type: 'real', value: at.x },
        'position.y': { type: 'real', value: at.y },
        width: { type: 'real', value: CARD_WIDTH },
      }
      for (const [key, value] of derived) props[key] = value

      const id = claimNodeId()
      if (id) idForPath.set(rel, id)

      units.push({ bytes, ops: [{ op: 'createNode', type: VAULT_NOTE_TYPE, props }] })
      created.push(rel)
      continue
    }

    idForPath.set(rel, existing.id)

    const textChanged = stringProp(existing, MD_SHA256) !== note.sha256
    const ops: OpObject[] = []

    if (textChanged) {
      ops.push(
        { op: 'setProperty', target: existing.id, key: MD_TEXT, type: 'text', value: note.text },
        {
          op: 'setProperty',
          target: existing.id,
          key: MD_SHA256,
          type: 'text',
          value: note.sha256,
        },
      )
    }

    // Derived keys are reconciled whether or not the text changed: a tree
    // written by Plan 07 has none of them yet, and this is what fills them in.
    for (const [key, value] of derived) {
      if (stringProp(existing, key) === value.value) continue
      ops.push({
        op: 'setProperty',
        target: existing.id,
        key,
        type: value.type,
        value: value.value,
      })
    }
    for (const key of storedDerivedKeys(existing)) {
      if (derived.has(key)) continue
      ops.push({ op: 'unsetProperty', target: existing.id, key })
    }

    if (ops.length === 0) continue
    units.push({ bytes: textChanged ? bytes : 0, ops })
    modified.push(rel)
  }

  // --- 3. Files (D-29) -----------------------------------------------------
  for (const rel of [...model.files.keys()].sort()) {
    const file = model.files.get(rel)!
    const existing = byPath.get(rel)

    const props: Record<string, PropValue> = {
      [MD_PATH]: { type: 'text', value: rel },
      [MD_EXT]: { type: 'text', value: file.ext },
      [MD_BYTES]: { type: 'int', value: file.bytes },
    }
    if (file.sha256) props[MD_SHA256] = { type: 'text', value: file.sha256 }
    if (file.unreadable) props[MD_UNREADABLE] = { type: 'text', value: file.unreadable }

    if (!existing) {
      const at = positions.get(rel) ?? { x: 0, y: 0 }
      const id = claimNodeId()
      if (id) idForPath.set(rel, id)

      units.push({
        bytes: 0,
        ops: [
          {
            op: 'createNode',
            type: VAULT_FILE_TYPE,
            props: {
              ...props,
              'position.x': { type: 'real', value: at.x },
              'position.y': { type: 'real', value: at.y },
              width: { type: 'real', value: 240 },
            },
          },
        ],
      })
      created.push(rel)
      continue
    }

    idForPath.set(rel, existing.id)

    const ops: OpObject[] = []
    for (const [key, value] of Object.entries(props)) {
      const current = existing.props[key]
      if (current && current.value === value.value) continue
      ops.push({ op: 'setProperty', target: existing.id, key, type: value.type, value: value.value })
    }
    // A file that became readable again loses the reason, rather than keeping
    // a stale explanation of a problem that is over.
    if (!file.unreadable && existing.props[MD_UNREADABLE]) {
      ops.push({ op: 'unsetProperty', target: existing.id, key: MD_UNREADABLE })
    }

    if (ops.length === 0) continue
    units.push({ bytes: 0, ops })
    modified.push(rel)
  }

  // --- 4. Placeholders (D-34) ---------------------------------------------
  for (const [key, placeholder] of [...desiredPlaceholders].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )) {
    const existing = placeholdersByKey.get(key)

    if (existing) {
      idForPlaceholder.set(key, existing.id)

      const ops: OpObject[] = []
      const storedAmbiguous = existing.props[MD_AMBIGUOUS]
      if (placeholder.ambiguous && storedAmbiguous?.value !== true) {
        ops.push({
          op: 'setProperty',
          target: existing.id,
          key: MD_AMBIGUOUS,
          type: 'bool',
          value: true,
        })
      } else if (!placeholder.ambiguous && storedAmbiguous) {
        ops.push({ op: 'unsetProperty', target: existing.id, key: MD_AMBIGUOUS })
      }
      if (ops.length > 0) units.push({ bytes: 0, ops })
      continue
    }

    const anchor = positionOf(placeholder.anchorRel)
    const props: Record<string, PropValue> = {
      [MD_LINK]: { type: 'text', value: placeholder.link },
      'position.x': { type: 'real', value: anchor.x + CARD_WIDTH + PLACEHOLDER_GAP },
      'position.y': { type: 'real', value: anchor.y },
      width: { type: 'real', value: 200 },
    }
    if (placeholder.ambiguous) props[MD_AMBIGUOUS] = { type: 'bool', value: true }

    const id = claimNodeId()
    if (id) idForPlaceholder.set(key, id)

    units.push({
      bytes: 0,
      ops: [{ op: 'createNode', type: VAULT_PLACEHOLDER_TYPE, props }],
    })
    created.push(`[[${placeholder.link}]]`)
  }

  // --- 5. Connections (D-31) ----------------------------------------------
  // An edge is keyed by everything that identifies it, so an edge that still
  // matches is left alone and any `tapestry.label` Kaelen put on it survives.
  function keyOfNode(id: string): string | null {
    const node = tree.nodes.find((candidate) => candidate.id === id)
    if (!node) return null
    const path = pathOf(node)
    if (path !== null) return path
    if (node.type === VAULT_PLACEHOLDER_TYPE) {
      const link = stringProp(node, MD_LINK)
      return link === null ? null : placeholderKey(link)
    }
    return null
  }

  const existingEdges = new Map<string, EdgeData>()
  for (const edge of tree.edges) {
    if (edge.label !== WIKILINK_LABEL && edge.label !== EMBED_LABEL) continue
    const from = keyOfNode(edge.from)
    const to = keyOfNode(edge.to)
    if (from === null || to === null) continue
    existingEdges.set(
      edgeKey(
        from,
        edge.label,
        to,
        stringProp(edge, MD_LINE) ?? '',
        numberProp(edge, MD_OCCURRENCE, 0),
      ),
      edge,
    )
  }

  const desiredKeys = new Set<string>()
  const edgeOps: OpObject[] = []

  for (const edge of desiredEdges) {
    const key = edgeKey(edge.fromRel, edge.label, edge.targetKey, edge.line, edge.occurrence)
    desiredKeys.add(key)
    if (existingEdges.has(key)) continue

    const from = idForPath.get(edge.fromRel)
    const to = edge.targetKey.startsWith('placeholder:')
      ? idForPlaceholder.get(edge.targetKey)
      : idForPath.get(edge.targetKey)
    // Without predicted ids a brand-new endpoint has no id yet; the edge waits
    // for the next catch-up rather than being written against a guess.
    if (!from || !to) continue

    edgeOps.push({
      op: 'createEdge',
      from,
      to,
      label: edge.label,
      props: {
        [MD_LINE]: { type: 'text', value: edge.line },
        [MD_OCCURRENCE]: { type: 'int', value: edge.occurrence },
      },
    })
  }

  const edgeDeleteOps: OpObject[] = []
  for (const [key, edge] of existingEdges) {
    if (desiredKeys.has(key)) continue
    edgeDeleteOps.push({ op: 'deleteEdge', id: edge.id })
  }

  // Deletions first: an edge whose line was rewritten is removed and written
  // again, and doing it in this order never leaves two edges claiming the
  // same connection.
  if (edgeDeleteOps.length > 0) units.push({ bytes: 0, ops: edgeDeleteOps })
  if (edgeOps.length > 0) units.push({ bytes: 0, ops: edgeOps })

  // --- 6. Deletions --------------------------------------------------------
  for (const [path, node] of byPath) {
    if (model.notes.has(path)) continue
    if (model.folders.has(path)) continue
    if (model.files.has(path)) continue

    units.push({ bytes: 0, ops: [{ op: 'deleteNode', id: node.id }] })
    deleted.push(path)
  }

  for (const [key, node] of placeholdersByKey) {
    if (desiredPlaceholders.has(key)) continue
    // Nobody links here any more — either the note was written, or the link
    // was removed from the file.
    units.push({ bytes: 0, ops: [{ op: 'deleteNode', id: node.id }] })
    deleted.push(`[[${stringProp(node, MD_LINK) ?? key}]]`)
  }

  // --- Chunking ------------------------------------------------------------
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
