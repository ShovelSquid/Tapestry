/**
 * Workspace record shapes (02.7).
 *
 * A workspace folder mirrors into a tree of three node types. Every `file.*`
 * key is what the file says — its path, text, hash, extension, size, or why it
 * cannot be shown — and is only ever set from a read of the file. Every other
 * key (position, width, labels) is Tapestry's own. This is the 02.2 `md.*`
 * rule under a neutral prefix, so a workspace file of any extension reads the
 * same way in the `.tree` file.
 */

import { createHash } from 'crypto'
import { realpathSync } from 'fs'
import { basename, join, resolve } from 'path'
import { TAPESTRY_TMP_MARKER } from '../mirror/atomic-write'
import type { MirrorLayout, MirrorShape } from '../mirror/plan'
import { COLLAPSED_KEY, SUBSPACE_KEY } from '../../renderer/layout/subspaces'

export const WORKSPACE_TEXT_TYPE = 'tapestry.workspace/text@1'
export const WORKSPACE_FILE_TYPE = 'tapestry.workspace/file@1'
export const WORKSPACE_FOLDER_TYPE = 'tapestry.workspace/folder@1'

export const FILE_PATH = 'file.path'
export const FILE_TEXT = 'file.text'
export const FILE_SHA256 = 'file.sha256'
export const FILE_EXT = 'file.ext'
export const FILE_BYTES = 'file.bytes'
export const FILE_UNREADABLE = 'file.unreadable'

/**
 * Tapestry keys on a workspace folder (02.7 D-21), never `file.*`: `subspace`
 * (bool true) says the folder's children are positioned relative to it, and
 * `collapsed` (bool) says it is drawn as its header only. Neither is ever read
 * from or written to disk. One definition, shared with the canvas.
 */
export const FOLDER_SUBSPACE = SUBSPACE_KEY
export const FOLDER_COLLAPSED = COLLAPSED_KEY

/**
 * Folder interiors are four cards wide. A row is 304 tall because a collapsed
 * text card measures about 270px with its provenance footer.
 */
export const WORKSPACE_LAYOUT: MirrorLayout = Object.freeze({
  columns: 4,
  columnStep: 304,
  rowStep: 304,
  labelHeight: 40,
  groupGap: 224,
  textCardWidth: 280,
  fileCardWidth: 240,
  subspaces: true,
})

export const WORKSPACE_SHAPE: MirrorShape = Object.freeze({
  textType: WORKSPACE_TEXT_TYPE,
  fileType: WORKSPACE_FILE_TYPE,
  folderType: WORKSPACE_FOLDER_TYPE,
  keys: Object.freeze({
    path: FILE_PATH,
    text: FILE_TEXT,
    sha256: FILE_SHA256,
    ext: FILE_EXT,
    bytes: FILE_BYTES,
    unreadable: FILE_UNREADABLE,
  }),
  layout: WORKSPACE_LAYOUT,
})

/** More files than this and the folder is refused rather than mirrored. */
export const MAX_WORKSPACE_FILES = 20000

/** The agent socket's 4 MiB line cap bounds what one write can carry. */
export const MAX_WORKSPACE_WRITE_BYTES = 4 * 1024 * 1024

export interface WorkspaceTreeFiles {
  name: string
  treePath: string
  worldName: string
  rootHash: string
}

/**
 * Where a workspace's tree lives: in app data, never inside the workspace, so
 * a git worktree stays clean. The hash of the real root keeps two folders with
 * one name apart, both in the file name and in the header's world token.
 */
export function workspaceTreeFiles(treesDir: string, root: string): WorkspaceTreeFiles {
  const name = basename(resolve(root))
  const rootHash = createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 8)
  return {
    name,
    rootHash,
    treePath: join(treesDir, `${name}-${rootHash}.tree`),
    worldName: `${name.replace(/[^A-Za-z0-9_-]/g, '_')}-${rootHash}`,
  }
}

/**
 * Paths a workspace outside git ignores: .git, node_modules, dot-segments,
 * Tapestry's own tree and log files, and atomic-write temp files.
 */
export function isIgnoredWorkspacePath(rel: string): boolean {
  for (const segment of rel.split('/')) {
    if (segment.length === 0) continue
    if (segment.toLowerCase() === '.git') return true
    if (segment === 'node_modules') return true
    if (segment.startsWith('.')) return true
    if (/\.tree$/i.test(segment)) return true
    if (/\.signin\.log$/i.test(segment)) return true
    if (/\.tree\.torn-/i.test(segment)) return true
    if (segment.includes(TAPESTRY_TMP_MARKER)) return true
  }
  return false
}
