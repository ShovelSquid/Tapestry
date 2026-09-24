/**
 * Reading every past value of one property key, in commit order (D-06).
 *
 * A thin wrapper over `KernelBridge.getPropertyValues`, which itself is
 * guarded by the bridge's own `ensureLoaded` rule. This is the main-process
 * half of the read path a reopened thread uses to rebuild its document from
 * `thread.log` records alone, never from the `body` checkpoint (see
 * ThreadOverlay.tsx's catch-up load).
 */

import type { KernelBridge, PropertyValueEntry } from '../kernel-bridge'

export type { PropertyValueEntry }

/**
 * Every value `key` was ever set to on `nodeId` in `bridge`'s open world,
 * in commit order, from commits after `fromSeq` (default: every commit).
 */
export function getPropertyValues(
  bridge: KernelBridge,
  nodeId: string,
  key: string,
  fromSeq?: number,
): PropertyValueEntry[] {
  return bridge.getPropertyValues(nodeId, key, fromSeq)
}
