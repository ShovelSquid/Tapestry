/**
 * Adding a tree to the space, with its rollback in one place (2.6 T-2.6-24,
 * review WR-02).
 *
 * Invariant: after an add, successful or not, the registry and the forest
 * agree about what is in the space. An add has two steps. `open` puts the
 * tree in the registry (and a vault add may also record an unavailable entry
 * and then throw, or adopt the tree and then fail its catch-up). `record`
 * writes its stand-in to the forest. If either step fails:
 *
 * - every registry entry this call introduced that joins no stand-in is
 *   closed again, so no tree is listed that the forest does not hold;
 * - an entry that existed before the call is kept, even when `open` returned
 *   it;
 * - an entry that joins a stand-in is kept, because the forest holds it: a
 *   concurrent add that succeeded while this one was waiting, or a stand-in
 *   written before a later step failed. Closing it would break the same
 *   invariant the other way round.
 *
 * The original error is rethrown unchanged, so the window still shows the
 * approved notice for it (4.9, 4.10).
 *
 * No Electron import: the handlers in index.ts pass their own steps in.
 */

import type { TreeEntry, TreeRegistry } from '../trees/registry'

export interface OpenWithRollbackSteps {
  /** Put the tree in the registry (open, create, or add a vault). */
  open: () => TreeEntry | Promise<TreeEntry>
  /** Record the opened tree in the forest. */
  record: (entry: TreeEntry) => void
  /** Whether a registry entry joins a stand-in in the open forest. */
  isMember: (treeId: string) => boolean
}

/**
 * Run `open` then `record`. On any failure, close every registry entry that
 * is new since the call began and joins no stand-in, then rethrow.
 */
export async function openWithRollback(
  registry: TreeRegistry,
  steps: OpenWithRollbackSteps,
): Promise<TreeEntry> {
  const before = new Set(registry.summary().map((t) => t.id))
  try {
    const entry = await steps.open()
    steps.record(entry)
    return entry
  } catch (err) {
    rollBack(registry, before, steps.isMember)
    throw err
  }
}

function rollBack(
  registry: TreeRegistry,
  before: Set<string>,
  isMember: (treeId: string) => boolean,
): void {
  let introduced: string[]
  try {
    introduced = registry
      .summary()
      .map((t) => t.id)
      .filter((id) => !before.has(id))
  } catch (err) {
    console.error('[openWithRollback] could not list the registry:', err)
    return
  }
  for (const id of introduced) {
    try {
      if (isMember(id)) continue
      registry.close(id)
    } catch (err) {
      console.error(`[openWithRollback] could not close ${id}:`, err)
    }
  }
}
