/**
 * What the window may change in a workspace tree (02.7 D-03).
 *
 * A workspace tree records what its files say. The window may move and
 * resize cards, collapse folders and connect notes, because those are
 * Tapestry's own data. It may not create or delete notes, set or unset any
 * `file.*` key, or rewind the tree: each would make the tree disagree with
 * the files. File text changes only through a file window's save path or the
 * agent file tools, which write the file and record it together.
 *
 * Pure: main's kernel:submit / kernel:undo / kernel:redo handlers consult it
 * for workspace trees (T-02.7-17, T-02.7-18), so a renderer cannot bypass it.
 */

import type { OpObject } from '../kernel-bridge'

export const WORKSPACE_SUBMIT_REFUSAL =
  'Workspace windows hold files; Tapestry changes a file only through its window or the file tools.'

export const WORKSPACE_REPLAY_REFUSAL =
  "Undo isn't available in a workspace window; the files are the record. Use git to undo a file change."

const FILE_KEY_PREFIX = 'file.'

/**
 * The refusal for a renderer submitting `ops` to a workspace tree, or null
 * when every op is allowed. A property op whose key is not a string is
 * refused (fail closed); ops the guard does not name go on to the kernel,
 * which validates them.
 */
export function workspaceSubmitRefusal(ops: readonly OpObject[]): string | null {
  for (const op of ops) {
    if (op === null || typeof op !== 'object') return WORKSPACE_SUBMIT_REFUSAL
    switch (op.op) {
      case 'createNode':
      case 'deleteNode':
        return WORKSPACE_SUBMIT_REFUSAL
      case 'setProperty':
      case 'unsetProperty':
        if (typeof op.key !== 'string' || op.key.startsWith(FILE_KEY_PREFIX)) return WORKSPACE_SUBMIT_REFUSAL
        break
      default:
        break
    }
  }
  return null
}
