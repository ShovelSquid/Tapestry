/**
 * The workspace sandbox (02.7 D-08): every agent and window path is resolved
 * against an open workspace root, or refused with a reason.
 *
 * Pure resolution. It reads only lstat and git check-ignore, and never writes,
 * so a refusal here has written nothing and committed nothing by construction.
 *
 * The rules run in a fixed order, cheapest and most absolute first: no
 * workspace, which workspace, the path's characters, where an absolute path
 * points, `..` / `.git` / temp-file segments, then a walk from the real root
 * that refuses any symbolic link along the way, then git's ignore rules.
 */

import { lstatSync, readdirSync } from 'fs'
import { isAbsolute, join, relative } from 'path'
import type { CommandResult } from '../commands/notes'
import type { OpenTree } from '../trees/registry'
import { TAPESTRY_TMP_MARKER } from '../mirror/atomic-write'
import { isGitIgnored } from '../mirror/fs'
import { isIgnoredWorkspacePath } from './shapes'

export interface OpenWorkspace {
  tree: OpenTree
  /** The folder as it was chosen. */
  root: string
  /** The folder with symlinks resolved (`/var` → `/private/var` on macOS). */
  realRoot: string
  /** Whether the folder is a git work tree (its mirror is git's view). */
  git: boolean
}

export interface WorkspaceLookup {
  openWorkspaces(): OpenWorkspace[]
}

export interface WorkspaceTarget {
  workspace: OpenWorkspace
  /**
   * Workspace-relative, `/`-separated. Existing segments carry their on-disk
   * spelling; segments that do not exist yet keep the caller's.
   */
  rel: string
  /** The absolute path under the real root. */
  abs: string
  exists: boolean
}

export const NO_WORKSPACE_MESSAGE =
  'No workspace is open in Tapestry. Open one with Add tree > Add Workspace Folder...; ' +
  'file tools never use any other folder.'

function refuse(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

/** The path of `candidate` inside `base`, or null when it lies outside. */
function inside(base: string, candidate: string): string | null {
  const rel = relative(base, candidate)
  if (rel === '') return ''
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return null
  return rel
}

function pickWorkspace(
  open: OpenWorkspace[],
  ref: string,
): CommandResult<OpenWorkspace> {
  const lower = ref.toLowerCase()
  const matches = open.filter((ws) => ws.tree.id === ref || ws.tree.name.toLowerCase() === lower)
  if (matches.length === 0) return refuse(`${ref} is not an open workspace`)
  if (matches.length > 1) return refuse(`Workspace name ${ref} is ambiguous; use the tree id`)
  return { ok: true, value: matches[0] }
}

/**
 * The on-disk spelling of `given`, an entry lstat found in `parent`: the
 * exact name when the folder holds it, else the single entry equal to it
 * ignoring case. Null when two entries match (ambiguous).
 */
function canonicalName(parent: string, given: string): string | null {
  const names = readdirSync(parent)
  if (names.includes(given)) return given
  const lower = given.toLowerCase()
  const matches = names.filter((entry) => entry.toLowerCase() === lower)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) return null
  // lstat found it but no listed name matches (for example a Unicode
  // normalization difference); keep the caller's spelling.
  return given
}

export function resolveWorkspaceTarget(
  lookup: WorkspaceLookup,
  args: { workspace?: string; path: string },
  mode: 'read' | 'write' | 'folder',
): CommandResult<WorkspaceTarget> {
  try {
    // 1. Something must be open.
    const open = lookup.openWorkspaces()
    if (open.length === 0) return refuse(NO_WORKSPACE_MESSAGE)

    // 2. A named workspace must be one of them.
    let workspace: OpenWorkspace | null = null
    if (args.workspace !== undefined) {
      const picked = pickWorkspace(open, args.workspace)
      if (!picked.ok) return picked
      workspace = picked.value
    }

    // 3. The characters of the path. A folder may be the root itself ('' or '.').
    const raw = args.path
    const emptyOk = mode === 'folder' && raw === ''
    if (typeof raw !== 'string' || (raw.length === 0 && !emptyOk) || raw.includes('\0') || raw.includes('\\')) {
      return refuse('path must name a file inside the workspace, with / between folders')
    }

    // 4. An absolute path must lie inside the workspace.
    let rel: string
    if (isAbsolute(raw)) {
      if (raw.split('/').includes('..')) {
        return refuse(`${raw} uses '..'; paths must stay inside the workspace`)
      }
      const within = (ws: OpenWorkspace): string | null => inside(ws.root, raw) ?? inside(ws.realRoot, raw)
      if (workspace) {
        const found = within(workspace)
        if (found === null) {
          return refuse(`${raw} is outside the workspace ${workspace.tree.name} (${workspace.root})`)
        }
        rel = found
      } else {
        let best: { ws: OpenWorkspace; rel: string; depth: number } | null = null
        for (const ws of open) {
          const found = within(ws)
          if (found === null) continue
          const depth = Math.max(ws.root.length, ws.realRoot.length)
          if (!best || depth > best.depth) best = { ws, rel: found, depth }
        }
        if (!best) return refuse(`${raw} is outside every open workspace`)
        workspace = best.ws
        rel = best.rel
      }
    } else {
      // 5. A relative path needs exactly one candidate workspace.
      if (!workspace) {
        if (open.length > 1) {
          const names = open.map((ws) => ws.tree.name).join(', ')
          return refuse(`Several workspaces are open (${names}); pass workspace`)
        }
        workspace = open[0]
      }
      rel = raw
    }

    // 6. Segments.
    const segments = rel === '' ? [] : rel.split('/').filter((segment) => segment !== '.')
    if (mode === 'folder' && segments.length === 0) {
      return {
        ok: true,
        value: { workspace, rel: '', abs: workspace.realRoot, exists: true },
      }
    }
    if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
      return refuse('path must name a file inside the workspace, not the workspace itself')
    }
    if (segments.includes('..')) {
      return refuse(`${raw} uses '..'; paths must stay inside the workspace`)
    }
    if (segments.some((segment) => segment.toLowerCase() === '.git')) {
      return refuse(`${raw} is inside .git; file tools never read or write git's own files`)
    }
    if (segments.some((segment) => segment.includes(TAPESTRY_TMP_MARKER))) {
      return refuse(`${raw} is a Tapestry temporary file`)
    }

    // 7. Walk from the real root; never through a link. On a case-insensitive
    // volume an existing segment takes its on-disk spelling, so a path spelled
    // in another case names the same file and the same note.
    const name = workspace.tree.name
    let current = workspace.realRoot
    let exists = true
    for (let i = 0; i < segments.length; i += 1) {
      const parent = current
      current = join(parent, segments[i])
      let stats
      try {
        stats = lstatSync(current)
        const canonical = canonicalName(parent, segments[i])
        if (canonical === null) {
          return refuse(`${raw} matches more than one name in ${inside(workspace.realRoot, parent) || name}`)
        }
        if (canonical !== segments[i]) {
          segments[i] = canonical
          current = join(parent, canonical)
          if (canonical.toLowerCase() === '.git') {
            return refuse(`${raw} is inside .git; file tools never read or write git's own files`)
          }
          if (canonical.includes(TAPESTRY_TMP_MARKER)) return refuse(`${raw} is a Tapestry temporary file`)
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        if (mode === 'folder') return refuse(`${raw} is not a folder in ${name}`)
        if (mode === 'read') return refuse(`${raw} does not exist in ${name}`)
        exists = false
        break
      }
      const prefix = segments.slice(0, i + 1).join('/')
      if (stats.isSymbolicLink()) {
        return refuse(`${prefix} is a symbolic link; file tools never follow links`)
      }
      const last = i === segments.length - 1
      if (!last && !stats.isDirectory()) return refuse(`${prefix} is not a folder`)
      if (last && mode === 'folder' && !stats.isDirectory()) return refuse(`${raw} is not a folder in ${name}`)
      if (last && mode !== 'folder' && stats.isDirectory()) return refuse(`${raw} is a folder, not a file`)
    }

    // 8. Only files the window shows (or would show).
    const cleanRel = segments.join('/')
    if (mode === 'folder') {
      // A folder prefix only narrows a listing, and ignored files are never listed.
      return { ok: true, value: { workspace, rel: cleanRel, abs: join(workspace.realRoot, ...segments), exists } }
    }
    const ignored = workspace.git
      ? isGitIgnored(workspace.realRoot, cleanRel)
      : isIgnoredWorkspacePath(cleanRel)
    if (ignored) {
      return refuse(`${raw} is ignored by git in ${name}; file tools reach only files the window shows`)
    }

    // 9.
    return {
      ok: true,
      value: { workspace, rel: cleanRel, abs: join(workspace.realRoot, ...segments), exists },
    }
  } catch (err) {
    return refuse(err instanceof Error ? err.message : String(err))
  }
}
