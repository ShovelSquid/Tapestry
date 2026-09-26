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
import { SESSION_NODE_TYPE } from '../../shared/chat/transcript'

export const WORKSPACE_SUBMIT_REFUSAL =
  'Workspace windows hold files; Tapestry changes a file only through its window or the file tools.'

export const WORKSPACE_REPLAY_REFUSAL =
  "Undo isn't available in a workspace window; the files are the record. Use git to undo a file change."

/**
 * A chat session note's conversation (`body`) and its `chat.*` keys are
 * written only by ChatService, one commit per turn (02.8 D-07). The window
 * may still retitle, move and resize the note.
 */
export const CHAT_BODY_REFUSAL = "A chat's conversation is written only by the chat itself."

const FILE_KEY_PREFIX = 'file.'
const CHAT_KEY_PREFIX = 'chat.'

function isChatKey(key: string): boolean {
  return key === 'body' || key.startsWith(CHAT_KEY_PREFIX)
}

/**
 * The refusal for a renderer submitting `ops` to a workspace tree, or null
 * when every op is allowed. A property op whose key is not a string is
 * refused (fail closed); ops the guard does not name go on to the kernel,
 * which validates them.
 *
 * `nodeTypeOf` names a node's type in the tree (main passes the tree's own
 * lookup, so the guard stays pure). Setting or unsetting `body` or any
 * `chat.*` key on a chat session note is refused (T-02.8-07).
 */
export function workspaceSubmitRefusal(
  ops: readonly OpObject[],
  nodeTypeOf?: (id: string) => string | undefined,
): string | null {
  for (const op of ops) {
    if (op === null || typeof op !== 'object') return WORKSPACE_SUBMIT_REFUSAL
    switch (op.op) {
      case 'createNode':
      case 'deleteNode':
        return WORKSPACE_SUBMIT_REFUSAL
      case 'setProperty':
      case 'unsetProperty':
        if (typeof op.key !== 'string' || op.key.startsWith(FILE_KEY_PREFIX)) return WORKSPACE_SUBMIT_REFUSAL
        if (isChatKey(op.key) && nodeTypeOf) {
          if (typeof op.target !== 'string') return WORKSPACE_SUBMIT_REFUSAL
          if (nodeTypeOf(op.target) === SESSION_NODE_TYPE) return CHAT_BODY_REFUSAL
        }
        break
      default:
        break
    }
  }
  return null
}
