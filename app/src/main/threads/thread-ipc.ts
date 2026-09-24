/**
 * Thread IPC — `thread:open`, `thread:push`, `thread:close`, and the
 * `thread:confirmed` broadcast, mirroring `KernelBridge.registerHandlers`'s
 * shape (every channel names its tree first, D-15; the renderer sends no
 * actor, D-06/D-07 — the host stamps it).
 */

import type { ThreadCause } from '../../shared/threads/grammar'
import type { Actor } from '../commands/actor'
import type { KernelBridge } from '../kernel-bridge'
import type { ThreadPushResult, ThreadService } from './thread-service'

/**
 * Registers the thread channels on `ipcMain`.
 *
 * `resolveTree` and `getHumanActor` are the same host-owned resolvers
 * `KernelBridge.registerHandlers` uses: a tree id is never a capability the
 * renderer can mint, and the renderer never supplies its own actor.
 *
 * `notifyConfirmed` is wired to `ThreadService.onFlush` by the caller so a
 * durable flush reaches every window watching this thread, not just the one
 * that pushed the steps that triggered it. `notifyFlushError` is the same
 * shape for `ThreadService.onFlushError` (T-02.3-02-06): a refused flush
 * must reach the overlay as "Not saved", not disappear into main's console.
 */
export class ThreadIpc {
  static registerHandlers(
    ipcMain: any,
    threadService: ThreadService,
    resolveTree: (treeId: unknown) => KernelBridge,
    getHumanActor: () => Actor,
    notifyConfirmed: (treeId: string, nodeId: string, version: number) => void,
    notifyFlushError: (treeId: string, nodeId: string, reason: string) => void,
  ): void {
    threadService.onFlush = notifyConfirmed
    threadService.onFlushError = notifyFlushError

    ipcMain.handle('thread:open', (_event: any, treeId: unknown, nodeId: unknown) => {
      if (typeof treeId !== 'string' || typeof nodeId !== 'string') {
        throw new Error('thread:open expects (treeId: string, nodeId: string)')
      }
      const bridge = resolveTree(treeId)
      return threadService.open(bridge, getHumanActor(), treeId, nodeId)
    })

    ipcMain.handle(
      'thread:push',
      (
        _event: any,
        treeId: unknown,
        nodeId: unknown,
        version: unknown,
        steps: unknown,
        times: unknown,
        causes: unknown,
      ): ThreadPushResult => {
        if (
          typeof treeId !== 'string' ||
          typeof nodeId !== 'string' ||
          typeof version !== 'number' ||
          !Array.isArray(steps) ||
          !Array.isArray(times) ||
          !Array.isArray(causes)
        ) {
          throw new Error(
            'thread:push expects (treeId: string, nodeId: string, version: number, steps: any[], times: number[], causes: (string|null)[])',
          )
        }
        // resolveTree throws for an id that is not open, refusing the push
        // before any step is touched (the same discipline kernel:submit uses).
        resolveTree(treeId)
        return threadService.push(
          treeId,
          nodeId,
          getHumanActor(),
          version,
          steps,
          times as number[],
          causes as (ThreadCause | null)[],
        )
      },
    )

    ipcMain.handle('thread:close', (_event: any, treeId: unknown, nodeId: unknown) => {
      if (typeof treeId !== 'string' || typeof nodeId !== 'string') {
        throw new Error('thread:close expects (treeId: string, nodeId: string)')
      }
      threadService.close(treeId, nodeId)
      return { ok: true }
    })
  }
}
