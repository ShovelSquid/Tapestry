/**
 * Agent file commands (02.7 D-07): read_file and edit_file.
 *
 * Every path goes through the workspace sandbox (D-08) before the disk is
 * touched, and every refusal returns before anything is written or committed.
 * An agent edit lands on disk at once; the tree then records what the file
 * says, signed by the agent (D-04). Before that, any disk state the tree has
 * not yet recorded is committed as an observation by `plugin workspace.bridge`
 * (D-06), so the agent is never credited with somebody else's change.
 *
 * Every method is synchronous and returns a CommandResult; none throws.
 */

import type { Actor } from './actor'
import type { CommandResult } from './notes'
import { readPathState, type PathState } from '../mirror/plan'
import { resolveWorkspaceTarget } from '../workspace/sandbox'
import { validateWorkspaceText, type WorkspaceService } from '../workspace/workspace-service'

const DEFAULT_READ_LIMIT = 2000

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
