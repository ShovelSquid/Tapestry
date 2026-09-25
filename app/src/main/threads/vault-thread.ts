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
import type { NodeData } from '../kernel-bridge'
import { VAULT_NOTE_TYPE } from '../obsidian/shapes'
import type { VaultService } from '../obsidian/vault-service'
import type { KernelBridge } from '../kernel-bridge'
import type { ThreadService } from './thread-service'

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
