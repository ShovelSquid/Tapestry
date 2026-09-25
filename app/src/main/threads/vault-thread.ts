/**
 * Vault threads (D-25) — a thread whose `.md` file is an ordinary vault note.
 *
 * A vault thread is not a new node type. It is an ordinary `obsidian.vault/
 * note@1` node (02.2 Plans 07/08) that additionally carries the thread
 * property set (`thread.timeout`, `thread.slowdown`, `thread.format`, the
 * D-27 frame keys, `thread.log`, `body`, `title`). The division 02.2 already
 * established is not bent here: every key starting `md.` is what the file
 * says, and every other key is Tapestry's (`obsidian/shapes.ts`). None of
 * the thread keys start with `md.`, so they belong in the vault's tree, and
 * the `.md` file itself holds only the current text — Obsidian opens it and
 * sees a perfectly normal note.
 *
 * This module owns no filesystem access of its own. Writing the `.md` file
 * is `VaultService.writeThreadFile`'s job (`obsidian/vault-service.ts`),
 * because the vault service already owns the filesystem, the reserved
 * `obsidian.bridge` actor and the vault's journal handle (Plan 01's
 * `RESERVED_PLUGIN_ID_PREFIXES`, 02.2 Plan 07's header comment). A second
 * file-writing path here would be exactly the mistake this plan's own
 * precondition warns against.
 */

import type { Actor } from '../commands/actor'
import type { KernelBridge, NodeData } from '../kernel-bridge'
import { VAULT_NOTE_TYPE } from '../obsidian/shapes'
import type { VaultService } from '../obsidian/vault-service'
import type { FlatDocText, ThreadService } from './thread-service'

// ---------------------------------------------------------------------------
// isVaultThread
// ---------------------------------------------------------------------------

/**
 * A marker key present only once a vault note has been made into a thread.
 * `thread.format` is chosen because `threadInitialProperties` (settings.ts)
 * always writes it, and it is never absent for a thread created any other
 * way either — the same key `ThreadService` and the tools use as "this node
 * carries thread properties" would, if a node-type discriminator were needed
 * instead of the ordinary `tapestry.threads/thread@1` type string.
 */
const THREAD_MARKER_KEY = 'thread.format'

/**
 * Whether `node` is a vault note that has also been made into a thread
 * (D-25). A plain vault note (no thread properties) and a plain
 * `tapestry.threads/thread@1` node (not a vault note) both answer false —
 * only the D-25 combination answers true.
 */
export function isVaultThread(node: Pick<NodeData, 'type' | 'props'>): boolean {
  return node.type === VAULT_NOTE_TYPE && THREAD_MARKER_KEY in node.props
}

// ---------------------------------------------------------------------------
// diffFlatText — the single-cluster diff every D-25 reconciliation uses
// ---------------------------------------------------------------------------

/** A single replace: remove `[from, to)` of the old text, insert `insertText`. */
export interface FlatTextDiff {
  from: number
  to: number
  insertText: string
}

/**
 * The smallest single replace that turns `oldText` into `newText`, expressed
 * as a common-prefix/common-suffix diff over UTF-16 code units. Returns
 * `null` when the two texts are identical — the "a no-op rewrite records
 * nothing" rule (D-20-style: a whole write is one tight cluster, never
 * spread out, and never invented when nothing actually changed).
 *
 * This is deliberately not a general multi-hunk diff: an edit made outside
 * Tapestry "arrives on the line as one observed cluster, like a paste"
 * (D-25) — one replace is exactly that shape, not an attempt to find the
 * minimal edit script across several separate changes.
 */
export function diffFlatText(oldText: string, newText: string): FlatTextDiff | null {
  if (oldText === newText) return null

  const maxPrefix = Math.min(oldText.length, newText.length)
  let start = 0
  while (start < maxPrefix && oldText[start] === newText[start]) start++

  let oldEnd = oldText.length
  let newEnd = newText.length
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--
    newEnd--
  }

  return { from: start, to: oldEnd, insertText: newText.slice(start, newEnd) }
}

/** Maps a 0-based index into a `FlatDocText`'s `text` to the real ProseMirror
 * document position immediately before that character — or `endPos` for an
 * index at (or past) the end of the text, matching `flatTextOf`'s own
 * convention (RESEARCH Pattern 2, `thread-service.ts`). */
function posAt(flat: FlatDocText, index: number): number {
  return index < flat.positions.length ? flat.positions[index] : flat.endPos
}

// ---------------------------------------------------------------------------
// observeVaultEdit — an external file edit arrives as one observed cluster
// ---------------------------------------------------------------------------

export type ObserveVaultEditResult = { changed: boolean } | { error: string }

/**
 * Reconciles a `.md` file's on-disk text (`observedText`, already read by
 * the caller — the vault watcher, once one exists) against the thread's
 * current authoritative document, recording the difference as **one**
 * `observed`-caused cluster (D-25) rather than replaying it as fake typing
 * or silently overwriting either side.
 *
 * `actor` is the attribution for the resulting commit: `OBSIDIAN_BRIDGE_ACTOR`
 * unless the caller has independently proven — from 02.2's agent sign-in log
 * — that a specific agent wrote exactly this content (02.2 D-21). This
 * module never guesses; it records whatever actor its caller supplies.
 */
export function observeVaultEdit(
  threadService: ThreadService,
  bridge: KernelBridge,
  actor: Actor,
  treeId: string,
  nodeId: string,
  observedText: string,
): ObserveVaultEditResult {
  const flat = threadService.readFlatText(bridge, actor, treeId, nodeId)
  if ('error' in flat) return flat

  const diff = diffFlatText(flat.text, observedText)
  if (!diff) return { changed: false }

  const result = threadService.applyObservedEdit(bridge, actor, treeId, nodeId, {
    from: posAt(flat, diff.from),
    to: posAt(flat, diff.to),
    insertText: diff.insertText,
  })
  if (!result.ok) return { error: result.error }
  return { changed: true }
}

// ---------------------------------------------------------------------------
// writeVaultThreadFile — Tapestry's own write reaches the vault file
// ---------------------------------------------------------------------------

/**
 * After a vault thread's `ThreadService` batch flushes, pushes the thread's
 * current text out to its `.md` file (D-25's other direction). The actual
 * filesystem write and the `md.text`/`md.sha256` commit that keeps the tree
 * honest about what the file now says both happen inside
 * `VaultService.writeThreadFile` — this function only decides *whether* a
 * sync applies to this node and gathers the text to write.
 */
export async function writeVaultThreadFile(
  vaultService: VaultService,
  threadService: ThreadService,
  bridge: KernelBridge,
  actor: Actor,
  treeId: string,
  nodeId: string,
): Promise<void> {
  const flat = threadService.readFlatText(bridge, actor, treeId, nodeId)
  if ('error' in flat) {
    throw new Error(flat.error)
  }
  await vaultService.writeThreadFile(treeId, nodeId, flat.text, actor)
}

/** The vault thread footer copy (UI-SPEC "No-plugin fallback"), verbatim.
 * `ThreadCard.tsx` cannot import this constant across the main/renderer
 * boundary (the renderer bundle never reaches into `main/`, the same
 * discipline `VaultNoteCard.tsx` already keeps toward `obsidian/shapes.ts`)
 * — it duplicates the literal string instead. This export exists so a
 * future main-side surface (or a test) has one source of truth to compare
 * against, and so the two copies cannot silently drift without a grep
 * catching it.
 */
export const VAULT_THREAD_FOOTER_TEXT =
  'Timings, deleted letters and authors are kept in Tapestry, not in this file.'
