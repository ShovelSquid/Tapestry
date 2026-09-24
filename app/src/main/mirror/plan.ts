/**
 * A folder, planned into a tree — the generic half of every mirror.
 *
 * Pure: no kernel, no Electron, no clock (except groupStamp). It takes what
 * the files say and what the tree currently records, and returns the ops that
 * would make the second match the first. A `MirrorShape` names the node types
 * and keys, so the vault and the workspace share one planner for folders,
 * text files, other files and deletions, while each keeps its own record
 * shape (the vault's Markdown layer sits on top of its own planner for now).
 */

import { lstatSync } from 'fs'
import { join, resolve } from 'path'
import type { NodeData, OpObject } from '../kernel-bridge'
import { decodeText, readBoundedBytes, type FolderEntry } from './fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MirrorLayout {
  columns: number
  columnStep: number
  rowStep: number
  /** Room above a group's first row for its label. */
  labelHeight: number
  /** Space between one group and the next: one spare row so a group can grow. */
  groupGap: number
  textCardWidth: number
  fileCardWidth: number
}

export interface MirrorShape {
  textType: string
  fileType: string
  folderType: string
  keys: {
    path: string
    text: string
    sha256: string
    ext: string
    bytes: string
    unreadable: string
  }
  layout: MirrorLayout
}

export type PathState =
  | { kind: 'absent' }
  | { kind: 'folder' }
  | { kind: 'text'; text: string; sha256: string }
  | { kind: 'file'; ext: string; bytes: number; sha256?: string; unreadable?: string }

export interface MirrorModel {
  folders: Set<string>
  /** Every non-folder path: text or file. */
  paths: Map<string, PathState>
}

export interface MirrorSummary {
  created: string[]
  modified: string[]
  deleted: string[]
}

export interface Point {
  x: number
  y: number
}

type PropValue = { type: string; value: string | number | boolean }

/** 32 MiB of text per commit, well inside the kernel's commit limit. */
export const MAX_COMMIT_TEXT_BYTES = 32 * 1024 * 1024

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Extension without the dot, lowercase. `map.png` → `png`; `.env` → ``. */
export function extensionOf(rel: string): string {
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Read a regular file's state: text if it decodes, otherwise a described file. */
function regularFileState(root: string, rel: string, size: number): PathState {
  const ext = extensionOf(rel)
  let read
  try {
    read = readBoundedBytes(root, rel)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { kind: 'absent' }
    if (code === 'ELOOP') return { kind: 'file', ext, bytes: size, unreadable: 'symbolic link not followed' }
    return { kind: 'file', ext, bytes: size, unreadable: errorText(err) }
  }
  if ('tooLarge' in read) {
    return { kind: 'file', ext, bytes: read.size, unreadable: `is larger than 16 MiB (${read.size} bytes)` }
  }
  const decoded = decodeText(read.bytes)
  if (decoded.ok) return { kind: 'text', text: decoded.text, sha256: read.sha256 }
  return { kind: 'file', ext, bytes: read.bytes.length, sha256: read.sha256, unreadable: decoded.reason }
}

/** What one path on disk is right now. Never follows a symlink. */
export function readPathState(root: string, rel: string): PathState {
  let stats
  try {
    stats = lstatSync(join(resolve(root), ...rel.split('/')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }
    return { kind: 'file', ext: extensionOf(rel), bytes: 0, unreadable: errorText(err) }
  }
  if (stats.isSymbolicLink()) {
    return { kind: 'file', ext: extensionOf(rel), bytes: stats.size, unreadable: 'symbolic link not followed' }
  }
  if (stats.isDirectory()) return { kind: 'folder' }
  if (!stats.isFile()) {
    return { kind: 'file', ext: extensionOf(rel), bytes: stats.size, unreadable: 'is not a regular file' }
  }
  return regularFileState(root, rel, stats.size)
}

/** Classify every entry: folders, text files and other files. */
export async function buildMirrorModel(
  root: string,
  entries: FolderEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<MirrorModel> {
  const model: MirrorModel = { folders: new Set(), paths: new Map() }
  const total = entries.filter((entry) => entry.kind !== 'dir').length
  let done = 0

  for (const entry of entries) {
    if (entry.kind === 'dir') {
      model.folders.add(entry.rel)
      continue
    }
    done += 1
    onProgress?.(done, total)

    if (entry.kind === 'symlink') {
      model.paths.set(entry.rel, {
        kind: 'file',
        ext: extensionOf(entry.rel),
        bytes: entry.size,
        unreadable: 'symbolic link not followed',
      })
      continue
    }

    const state = regularFileState(root, entry.rel, entry.size)
    // A file deleted between the listing and the read is simply not there.
    if (state.kind === 'absent') continue
    model.paths.set(entry.rel, state)
    // Yield now and then so a large folder does not freeze the main process.
    if (done % 200 === 0) await new Promise((r) => setImmediate(r))
  }

  return model
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function parentOf(rel: string): string {
  const cut = rel.lastIndexOf('/')
  return cut === -1 ? '' : rel.slice(0, cut)
}

function ancestorsOf(rel: string): string[] {
  const segments = rel.split('/')
  const out: string[] = []
  for (let i = 1; i < segments.length; i += 1) out.push(segments.slice(0, i).join('/'))
  return out
}

function gridSlot(layout: MirrorLayout, origin: Point, index: number): Point {
  return {
    x: origin.x + (index % layout.columns) * layout.columnStep,
    y: origin.y + Math.floor(index / layout.columns) * layout.rowStep,
  }
}

/**
 * Where every item and folder sits on first import.
 *
 * Root items first, then each folder as a labelled group in path order, with
 * one spare row between groups so a group can grow by a row without covering
 * the next. Pure and total: the same folder lays out the same way everywhere.
 */
export function layoutFolderGrid(model: MirrorModel, layout: MirrorLayout): Map<string, Point> {
  const positions = new Map<string, Point>()
  const items = [...model.paths.keys()].sort()
  const rowsFor = (count: number): number => Math.ceil(count / layout.columns)

  const rootItems = items.filter((rel) => !rel.includes('/'))
  rootItems.forEach((rel, i) => positions.set(rel, gridSlot(layout, { x: 0, y: 0 }, i)))
  let cursor = rowsFor(rootItems.length) * layout.rowStep

  const byParent = new Map<string, string[]>()
  for (const rel of items) {
    const parent = parentOf(rel)
    if (parent === '') continue
    const list = byParent.get(parent) ?? []
    list.push(rel)
    byParent.set(parent, list)
  }

  // Every folder named by an item's path counts, even when the listing did not
  // name it separately.
  const folders = new Set(model.folders)
  for (const rel of items) for (const a of ancestorsOf(rel)) folders.add(a)

  for (const folder of [...folders].sort()) {
    if (cursor > 0) cursor += layout.groupGap
    positions.set(folder, { x: 0, y: cursor })
    const inside = byParent.get(folder) ?? []
    inside.forEach((rel, i) =>
      positions.set(rel, gridSlot(layout, { x: 0, y: cursor + layout.labelHeight }, i)),
    )
    cursor += layout.labelHeight + rowsFor(inside.length) * layout.rowStep
  }

  return positions
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function stringProp(node: NodeData, key: string): string | null {
  const prop = node.props[key]
  return prop && typeof prop.value === 'string' ? prop.value : null
}

function numberProp(node: NodeData, key: string, fallback: number): number {
  const prop = node.props[key]
  return prop && typeof prop.value === 'number' ? prop.value : fallback
}

/** Mutable planning state shared by the calls of one plan. */
interface PlanContext {
  shape: MirrorShape
  byPath: Map<string, NodeData | 'planned'>
  /** Direct non-folder children per folder ('' is the root). */
  childCount: Map<string, number>
  folderPos: Map<string, Point>
  lowestY: number
  /** First-import positions, when the tree held nothing of this shape. */
  grid: Map<string, Point> | null
}

function isShapeNode(node: NodeData, shape: MirrorShape): boolean {
  return node.type === shape.textType || node.type === shape.fileType || node.type === shape.folderType
}

function makeContext(nodes: NodeData[], shape: MirrorShape, model: MirrorModel | null): PlanContext {
  const ctx: PlanContext = {
    shape,
    byPath: new Map(),
    childCount: new Map(),
    folderPos: new Map(),
    lowestY: Number.NEGATIVE_INFINITY,
    grid: null,
  }
  let any = false
  for (const node of nodes) {
    if (!isShapeNode(node, shape)) continue
    const path = stringProp(node, shape.keys.path)
    if (path === null) continue
    any = true
    ctx.byPath.set(path, node)
    const at = { x: numberProp(node, 'position.x', 0), y: numberProp(node, 'position.y', 0) }
    ctx.lowestY = Math.max(ctx.lowestY, at.y)
    if (node.type === shape.folderType) {
      ctx.folderPos.set(path, at)
    } else {
      const parent = parentOf(path)
      ctx.childCount.set(parent, (ctx.childCount.get(parent) ?? 0) + 1)
    }
  }
  if (!any && model) ctx.grid = layoutFolderGrid(model, shape.layout)
  return ctx
}

function newFolderPosition(ctx: PlanContext, rel: string): Point {
  const fromGrid = ctx.grid?.get(rel)
  const at = fromGrid ?? {
    x: 0,
    y: Number.isFinite(ctx.lowestY)
      ? ctx.lowestY + ctx.shape.layout.rowStep + ctx.shape.layout.groupGap
      : 0,
  }
  ctx.folderPos.set(rel, at)
  ctx.lowestY = Math.max(Number.isFinite(ctx.lowestY) ? ctx.lowestY : at.y, at.y)
  return at
}

function newItemPosition(ctx: PlanContext, rel: string): Point {
  const parent = parentOf(rel)
  const index = ctx.childCount.get(parent) ?? 0
  ctx.childCount.set(parent, index + 1)
  const fromGrid = ctx.grid?.get(rel)
  if (fromGrid) return fromGrid

  const layout = ctx.shape.layout
  const folder = parent === '' ? { x: 0, y: 0 } : (ctx.folderPos.get(parent) ?? { x: 0, y: 0 })
  const origin = parent === '' ? folder : { x: folder.x, y: folder.y + layout.labelHeight }
  const at = gridSlot(layout, origin, index)
  ctx.lowestY = Math.max(Number.isFinite(ctx.lowestY) ? ctx.lowestY : at.y, at.y)
  return at
}

function positionProps(at: Point): Record<string, PropValue> {
  return {
    'position.x': { type: 'real', value: at.x },
    'position.y': { type: 'real', value: at.y },
  }
}

function fileProps(shape: MirrorShape, state: Extract<PathState, { kind: 'file' }>): Record<string, PropValue> {
  const props: Record<string, PropValue> = {
    [shape.keys.ext]: { type: 'text', value: state.ext },
    [shape.keys.bytes]: { type: 'int', value: state.bytes },
  }
  if (state.sha256) props[shape.keys.sha256] = { type: 'text', value: state.sha256 }
  if (state.unreadable) props[shape.keys.unreadable] = { type: 'text', value: state.unreadable }
  return props
}

function createOp(ctx: PlanContext, rel: string, state: PathState, at: Point): OpObject {
  const { shape } = ctx
  const path = { [shape.keys.path]: { type: 'text', value: rel } }
  if (state.kind === 'folder') {
    return { op: 'createNode', type: shape.folderType, props: { ...path, ...positionProps(at) } }
  }
  if (state.kind === 'text') {
    return {
      op: 'createNode',
      type: shape.textType,
      props: {
        ...path,
        [shape.keys.text]: { type: 'text', value: state.text },
        [shape.keys.sha256]: { type: 'text', value: state.sha256 },
        ...positionProps(at),
        width: { type: 'real', value: shape.layout.textCardWidth },
      },
    }
  }
  if (state.kind === 'file') {
    return {
      op: 'createNode',
      type: shape.fileType,
      props: {
        ...path,
        ...fileProps(shape, state),
        ...positionProps(at),
        width: { type: 'real', value: shape.layout.fileCardWidth },
      },
    }
  }
  throw new Error('An absent path has no node to create')
}

function typeFor(shape: MirrorShape, state: PathState): string | null {
  if (state.kind === 'folder') return shape.folderType
  if (state.kind === 'text') return shape.textType
  if (state.kind === 'file') return shape.fileType
  return null
}

type Change = 'created' | 'modified' | 'deleted' | null

interface PathPlan {
  ops: OpObject[]
  change: Change
  /** Ancestor folders created on the way. */
  createdFolders: string[]
  /** Text bytes carried, for chunking. */
  bytes: number
}

function planWith(ctx: PlanContext, rel: string, state: PathState): PathPlan {
  const { shape } = ctx
  const existing = ctx.byPath.get(rel)
  const ops: OpObject[] = []

  if (state.kind === 'absent') {
    if (!existing || existing === 'planned') return { ops, change: null, createdFolders: [], bytes: 0 }
    ctx.byPath.delete(rel)
    return { ops: [{ op: 'deleteNode', id: existing.id }], change: 'deleted', createdFolders: [], bytes: 0 }
  }

  if (existing === 'planned') return { ops, change: null, createdFolders: [], bytes: 0 }

  const wantType = typeFor(shape, state)!
  const textBytes = state.kind === 'text' ? Buffer.byteLength(state.text, 'utf-8') : 0

  if (existing && existing.type === wantType) {
    if (state.kind === 'text') {
      if (stringProp(existing, shape.keys.sha256) === state.sha256) {
        return { ops, change: null, createdFolders: [], bytes: 0 }
      }
      ops.push(
        { op: 'setProperty', target: existing.id, key: shape.keys.text, type: 'text', value: state.text },
        { op: 'setProperty', target: existing.id, key: shape.keys.sha256, type: 'text', value: state.sha256 },
      )
      return { ops, change: 'modified', createdFolders: [], bytes: textBytes }
    }
    if (state.kind === 'file') {
      for (const [key, value] of Object.entries(fileProps(shape, state))) {
        const current = existing.props[key]
        if (current && current.value === value.value) continue
        ops.push({ op: 'setProperty', target: existing.id, key, type: value.type, value: value.value })
      }
      if (!state.sha256 && existing.props[shape.keys.sha256]) {
        ops.push({ op: 'unsetProperty', target: existing.id, key: shape.keys.sha256 })
      }
      if (!state.unreadable && existing.props[shape.keys.unreadable]) {
        ops.push({ op: 'unsetProperty', target: existing.id, key: shape.keys.unreadable })
      }
      return { ops, change: ops.length > 0 ? 'modified' : null, createdFolders: [], bytes: 0 }
    }
    return { ops, change: null, createdFolders: [], bytes: 0 }
  }

  if (existing) {
    // The path changed kind (text ↔ file ↔ folder): replace the node where it sat.
    const at = { x: numberProp(existing, 'position.x', 0), y: numberProp(existing, 'position.y', 0) }
    ops.push({ op: 'deleteNode', id: existing.id }, createOp(ctx, rel, state, at))
    ctx.byPath.set(rel, 'planned')
    if (state.kind === 'folder') ctx.folderPos.set(rel, at)
    return { ops, change: 'modified', createdFolders: [], bytes: textBytes }
  }

  // A new path: every missing ancestor folder first, outermost first.
  const createdFolders: string[] = []
  for (const ancestor of ancestorsOf(rel)) {
    if (ctx.byPath.has(ancestor)) continue
    ops.push(createOp(ctx, ancestor, { kind: 'folder' }, newFolderPosition(ctx, ancestor)))
    ctx.byPath.set(ancestor, 'planned')
    createdFolders.push(ancestor)
  }
  const at = state.kind === 'folder' ? newFolderPosition(ctx, rel) : newItemPosition(ctx, rel)
  ops.push(createOp(ctx, rel, state, at))
  ctx.byPath.set(rel, 'planned')
  return { ops, change: 'created', createdFolders, bytes: textBytes }
}

/** The ops that make the tree record one path's current state. */
export function planPathChange(
  tree: { nodes: NodeData[] },
  rel: string,
  state: PathState,
  shape: MirrorShape,
): { ops: OpObject[]; change: Change } {
  const ctx = makeContext(tree.nodes, shape, null)
  const plan = planWith(ctx, rel, state)
  return { ops: plan.ops, change: plan.change }
}

/**
 * A full reconcile: every folder and path in the model, then a deletion for
 * every shape node whose path the model no longer holds. Chunked so no commit
 * carries more than MAX_COMMIT_TEXT_BYTES of text.
 */
export function planMirror(
  tree: { nodes: NodeData[] },
  model: MirrorModel,
  shape: MirrorShape,
): { ops: OpObject[][]; summary: MirrorSummary } {
  const ctx = makeContext(tree.nodes, shape, model)
  const summary: MirrorSummary = { created: [], modified: [], deleted: [] }
  const units: Array<{ ops: OpObject[]; bytes: number }> = []

  function record(rel: string, plan: PathPlan): void {
    if (plan.ops.length === 0) return
    units.push({ ops: plan.ops, bytes: plan.bytes })
    summary.created.push(...plan.createdFolders)
    if (plan.change === 'created') summary.created.push(rel)
    else if (plan.change === 'modified') summary.modified.push(rel)
    else if (plan.change === 'deleted') summary.deleted.push(rel)
  }

  const existingPaths = [...ctx.byPath.entries()]

  for (const folder of [...model.folders].sort()) {
    record(folder, planWith(ctx, folder, { kind: 'folder' }))
  }
  for (const rel of [...model.paths.keys()].sort()) {
    record(rel, planWith(ctx, rel, model.paths.get(rel)!))
  }

  // Deletions: deepest paths first, so a folder goes after its contents.
  const gone = existingPaths
    .filter(([path]) => !model.paths.has(path) && !model.folders.has(path))
    .filter(([path]) => {
      // A folder that still has a mirrored item beneath it stays.
      const node = ctx.byPath.get(path)
      if (node && node !== 'planned' && node.type === shape.folderType) {
        for (const rel of model.paths.keys()) if (rel.startsWith(`${path}/`)) return false
      }
      return true
    })
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
  for (const [path, node] of gone) {
    if (node === 'planned') continue
    units.push({ ops: [{ op: 'deleteNode', id: node.id }], bytes: 0 })
    summary.deleted.push(path)
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

  return { ops, summary }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * What an observation says it saw. One modified path gets a sentence naming
 * it; anything else is itemised. Neither form claims an author (02.2 D-21).
 */
export function describeMirrorChanges(summary: MirrorSummary): string {
  const { created, modified, deleted } = summary
  if (created.length === 0 && deleted.length === 0 && modified.length === 1) {
    return `observed change to ${modified[0]}`
  }
  const parts: string[] = []
  if (created.length > 0) parts.push(`created ${created.join(', ')}`)
  if (modified.length > 0) parts.push(`modified ${modified.join(', ')}`)
  if (deleted.length > 0) parts.push(`deleted ${deleted.join(', ')}`)
  return `observed changes: ${parts.join('; ')}`
}

/** A whole-second stamp shared by every commit of one group (02.2 D-23). */
export function groupStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}
