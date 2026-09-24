/**
 * Agent file commands (02.7 D-07): list_files, read_file, write_file,
 * edit_file.
 *
 * Every path goes through the workspace sandbox (D-08) before the disk is
 * touched, and every refusal returns before anything is written or committed.
 * An agent edit lands on disk at once; the tree then records what the file
 * says, signed by the agent (D-04). Before that, any disk state the tree has
 * not yet recorded is committed as an observation by `plugin workspace.watcher`
 * (D-06), so the agent is never credited with somebody else's change.
 *
 * Every method is synchronous and returns a CommandResult; none throws.
 */

import { lstatSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import type { Actor } from './actor'
import type { CommandResult } from './notes'
import { TAPESTRY_TMP_MARKER } from '../mirror/atomic-write'
import { listGitFiles, sha256Hex } from '../mirror/fs'
import { readPathState, type PathState } from '../mirror/plan'
import { resolveWorkspaceTarget, type OpenWorkspace } from '../workspace/sandbox'
import {
  isIgnoredWorkspacePath,
  MAX_WORKSPACE_WRITE_BYTES,
  WORKSPACE_FILE_TYPE,
  WORKSPACE_TEXT_TYPE,
} from '../workspace/shapes'
import type { WorkspaceService } from '../workspace/workspace-service'

const DEFAULT_READ_LIMIT = 2000
const DEFAULT_LIST_LIMIT = 1000

/** FORMAT.md "Limits": a line is at most 1 MiB. */
const MAX_LINE_BYTES = 1024 * 1024

/**
 * Whether `text` can become a file's bytes and a note's text unchanged.
 * Returns the refusal, or null. Shared by agent edits, agent writes and
 * window saves.
 */
export function validateWorkspaceText(text: string): string | null {
  if (text.includes('\0')) return 'text must not contain NUL'
  if (Buffer.from(text, 'utf-8').toString('utf-8') !== text) {
    return 'text must be valid Unicode (it contains an unpaired surrogate)'
  }
  const bytes = Buffer.byteLength(text, 'utf-8')
  if (bytes > MAX_WORKSPACE_WRITE_BYTES) return `text must be at most ${MAX_WORKSPACE_WRITE_BYTES} bytes`
  if (bytes > MAX_LINE_BYTES) {
    for (const line of text.split('\n')) {
      if (Buffer.byteLength(line, 'utf-8') > MAX_LINE_BYTES) return 'text has a line longer than 1 MiB'
    }
  }
  return null
}

export interface ListedFile {
  path: string
  bytes: number
  /** From the recorded note's type; null when the tree has not recorded the file yet. */
  kind: 'text' | 'file' | null
  note: string | null
}

export interface ListFilesValue {
  workspace: string
  root: string
  folder: string
  files: ListedFile[]
  total: number
  truncated: boolean
}

export interface WriteFileValue {
  workspace: string
  path: string
  note: string
  seq: number
  sha256: string
  created: boolean
  unchanged?: true
}

/**
 * Every file path under `realRoot` the non-git ignore rules keep, walked with
 * lstat and never through a link. Synchronous, so the file tools stay so.
 */
function walkFilesSync(realRoot: string): string[] {
  const out: string[] = []
  const visit = (abs: string, rel: string): void => {
    let names: string[]
    try {
      names = readdirSync(abs)
    } catch {
      return
    }
    for (const name of names) {
      const childRel = rel ? `${rel}/${name}` : name
      if (isIgnoredWorkspacePath(childRel)) continue
      let stats
      try {
        stats = lstatSync(join(abs, name))
      } catch {
        continue
      }
      if (stats.isDirectory()) visit(join(abs, name), childRel)
      else if (stats.isFile() || stats.isSymbolicLink()) out.push(childRel)
    }
  }
  visit(realRoot, '')
  return out
}

/** The files the workspace window shows (git's view, or the non-git rules). */
function listWorkspaceRels(ws: OpenWorkspace): string[] {
  const listing = listGitFiles(ws.realRoot)
  if (listing.kind === 'git') {
    return listing.rels.filter(
      (rel) => !rel.split('/').some((s) => s.toLowerCase() === '.git' || s.includes(TAPESTRY_TMP_MARKER)),
    )
  }
  return walkFilesSync(ws.realRoot)
}

export interface ReadFileValue {
  workspace: string
  path: string
  note: string | null
  text: string
  sha256: string
  totalLines: number
  startLine: number
  endLine: number
}

export interface EditFileValue {
  workspace: string
  path: string
  note: string
  seq: number
  sha256: string
  replacements: number
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function notText(path: string, state: PathState): string {
  const reason = state.kind === 'file' ? (state.unreadable ?? 'binary') : 'binary'
  return `${path} is not a text file (${reason}); Tapestry shows only its name and size`
}

function notWritable(path: string, state: PathState): string {
  const reason = state.kind === 'file' ? (state.unreadable ?? 'binary') : 'a folder'
  return `${path} is not a text file (${reason}); write_file replaces only text files`
}

function countOccurrences(text: string, needle: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const at = text.indexOf(needle, from)
    if (at === -1) return count
    count += 1
    from = at + needle.length
  }
}

/** Apply one edit to `text`, or say why it cannot be applied. */
function applyEdit(
  text: string,
  path: string,
  args: { old_string: string; new_string: string; replace_all?: boolean },
): CommandResult<{ next: string; replacements: number }> {
  if (args.old_string === args.new_string) {
    return { ok: false, error: 'new_string must differ from old_string' }
  }
  const count = countOccurrences(text, args.old_string)
  if (count === 0) return { ok: false, error: `old_string was not found in ${path}` }
  if (count > 1 && !args.replace_all) {
    return {
      ok: false,
      error: `old_string occurs ${count} times in ${path}; add surrounding lines to make it unique, or pass replace_all`,
    }
  }
  let next: string
  if (args.replace_all) {
    next = text.split(args.old_string).join(args.new_string)
  } else {
    const at = text.indexOf(args.old_string)
    next = text.slice(0, at) + args.new_string + text.slice(at + args.old_string.length)
  }
  const invalid = validateWorkspaceText(next)
  if (invalid) return { ok: false, error: invalid }
  return { ok: true, value: { next, replacements: args.replace_all ? count : 1 } }
}

export class WorkspaceFileCommands {
  private readonly workspaces: WorkspaceService

  constructor(workspaces: WorkspaceService) {
    this.workspaces = workspaces
  }

  listFiles(args: { workspace?: string; path?: string; limit?: number }): CommandResult<ListFilesValue> {
    try {
      const resolved = resolveWorkspaceTarget(
        this.workspaces,
        { workspace: args.workspace, path: args.path ?? '' },
        'folder',
      )
      if (!resolved.ok) return resolved
      const target = resolved.value
      const ws = target.workspace
      const prefix = target.rel

      // Kind and note from what the tree records, by path.
      const recorded = new Map<string, { id: string; type: string }>()
      for (const node of ws.tree.bridge.getNodes()) {
        const path = node.props['file.path']
        if (path && typeof path.value === 'string') recorded.set(path.value, { id: node.id, type: node.type })
      }

      const files: ListedFile[] = []
      for (const rel of listWorkspaceRels(ws)) {
        if (prefix !== '' && !rel.startsWith(`${prefix}/`)) continue
        let stats
        try {
          stats = lstatSync(join(ws.realRoot, ...rel.split('/')))
        } catch {
          continue
        }
        if (stats.isDirectory()) continue
        const note = recorded.get(rel)
        const kind =
          note?.type === WORKSPACE_TEXT_TYPE ? 'text' : note?.type === WORKSPACE_FILE_TYPE ? 'file' : null
        files.push({ path: rel, bytes: stats.size, kind, note: note?.id ?? null })
      }
      files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      const limit = args.limit ?? DEFAULT_LIST_LIMIT
      return {
        ok: true,
        value: {
          workspace: ws.tree.name,
          root: ws.root,
          folder: prefix,
          files: files.slice(0, limit),
          total: files.length,
          truncated: files.length > limit,
        },
      }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }
  }

  readFile(args: {
    workspace?: string
    path: string
    offset?: number
    limit?: number
  }): CommandResult<ReadFileValue> {
    try {
      const resolved = resolveWorkspaceTarget(this.workspaces, args, 'read')
      if (!resolved.ok) return resolved
      const target = resolved.value
      const name = target.workspace.tree.name

      const state = readPathState(target.workspace.realRoot, target.rel)
      if (state.kind === 'absent') return { ok: false, error: `${args.path} does not exist in ${name}` }
      if (state.kind !== 'text') return { ok: false, error: notText(args.path, state) }

      const text = state.text
      const lines = text.split('\n')
      const trailing = text.endsWith('\n')
      const totalLines = text.length === 0 ? 0 : trailing ? lines.length - 1 : lines.length
      const startLine = args.offset ?? 1
      const limit = args.limit ?? DEFAULT_READ_LIMIT
      const endLine = Math.min(totalLines, startLine - 1 + limit)
      let page = endLine >= startLine ? lines.slice(startLine - 1, endLine).join('\n') : ''
      if (endLine >= startLine && endLine === totalLines && trailing) page += '\n'

      const note = this.workspaces.noteForPath(target.workspace.tree, target.rel)
      return {
        ok: true,
        value: {
          workspace: name,
          path: target.rel,
          note: note?.id ?? null,
          text: page,
          sha256: state.sha256,
          totalLines,
          startLine,
          endLine,
        },
      }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }
  }

  writeFile(actor: Actor, args: { workspace?: string; path: string; text: string }): CommandResult<WriteFileValue> {
    try {
      // 1. Where, and whether the text can be a file.
      const resolved = resolveWorkspaceTarget(this.workspaces, args, 'write')
      if (!resolved.ok) return resolved
      const target = resolved.value
      const ws = target.workspace
      const name = ws.tree.name
      const invalid = validateWorkspaceText(args.text)
      if (invalid) return { ok: false, error: invalid }

      // 2. What the disk says now (no commit yet).
      const disk = readPathState(ws.realRoot, target.rel)
      if (disk.kind === 'file' || disk.kind === 'folder') {
        return { ok: false, error: notWritable(args.path, disk) }
      }

      // 3. Nothing to do: no write, no commit.
      const sha256 = sha256Hex(args.text)
      if (disk.kind === 'text' && disk.sha256 === sha256) {
        const note = this.workspaces.noteForPath(ws.tree, target.rel)
        return {
          ok: true,
          value: {
            workspace: name,
            path: target.rel,
            note: note?.id ?? '',
            seq: ws.tree.bridge.status().lastGoodSeq,
            sha256,
            created: false,
            unchanged: true,
          },
        }
      }

      // 4. Observe first (D-06).
      const observed = this.workspaces.observePath(ws, target.rel)
      if (observed.kind === 'file' || observed.kind === 'folder') {
        return { ok: false, error: notWritable(args.path, observed) }
      }
      const created = observed.kind === 'absent'

      // 5. Missing folders, one segment at a time, never through a link.
      const segments = target.rel.split('/')
      let dir = ws.realRoot
      for (let i = 0; i < segments.length - 1; i += 1) {
        dir = join(dir, segments[i])
        const prefix = segments.slice(0, i + 1).join('/')
        let stats
        try {
          stats = lstatSync(dir)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
          mkdirSync(dir, { mode: 0o755 })
          continue
        }
        if (stats.isSymbolicLink()) {
          return { ok: false, error: `${prefix} is a symbolic link; file tools never follow links` }
        }
        if (!stats.isDirectory()) return { ok: false, error: `${prefix} is not a folder` }
      }

      // 6. Write, then record as the agent.
      const written = this.workspaces.commitWrite(
        actor,
        { ...target, exists: !created },
        args.text,
        created ? `create ${target.rel}` : `write ${target.rel}`,
      )
      return {
        ok: true,
        value: {
          workspace: name,
          path: target.rel,
          note: written.note,
          seq: written.seq,
          sha256: written.sha256,
          created,
        },
      }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }
  }

  editFile(
    actor: Actor,
    args: {
      workspace?: string
      path: string
      old_string: string
      new_string: string
      replace_all?: boolean
    },
  ): CommandResult<EditFileValue> {
    try {
      // 1. Where.
      const resolved = resolveWorkspaceTarget(this.workspaces, args, 'write')
      if (!resolved.ok) return resolved
      const target = resolved.value
      const ws = target.workspace
      const name = ws.tree.name
      if (!target.exists) return { ok: false, error: `${args.path} does not exist in ${name}` }

      // 2. What the disk says now (no commit yet).
      const disk = readPathState(ws.realRoot, target.rel)
      if (disk.kind === 'absent') return { ok: false, error: `${args.path} does not exist in ${name}` }
      if (disk.kind !== 'text') return { ok: false, error: notText(args.path, disk) }

      // 3-4. The edit itself.
      let edit = applyEdit(disk.text, target.rel, args)
      if (!edit.ok) return edit

      // 5. Observe first (D-06): record any disk state the tree has not seen.
      const observed = this.workspaces.observePath(ws, target.rel)
      if (observed.kind !== 'text' || observed.sha256 !== disk.sha256) {
        if (observed.kind === 'absent') return { ok: false, error: `${args.path} does not exist in ${name}` }
        if (observed.kind !== 'text') return { ok: false, error: notText(args.path, observed) }
        edit = applyEdit(observed.text, target.rel, args)
        if (!edit.ok) return edit
      }

      // 6. Write, then record as the agent.
      const { next, replacements } = edit.value
      const written = this.workspaces.commitWrite(
        actor,
        target,
        next,
        `edit ${target.rel} (${replacements} ${replacements === 1 ? 'replacement' : 'replacements'})`,
      )
      return {
        ok: true,
        value: {
          workspace: name,
          path: target.rel,
          note: written.note,
          seq: written.seq,
          sha256: written.sha256,
          replacements,
        },
      }
    } catch (err) {
      return { ok: false, error: errorText(err) }
    }
  }
}
