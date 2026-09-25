/**
 * Whether each workspace's outside changes are being recorded (02.7 D-06),
 * for its frame header.
 *
 * One module-level subscription to `workspace-status` keeps the last status
 * per tree, so a header mounted after an event (a frame scrolled into view, a
 * renderer reload) still shows it. On first use it also asks main for every
 * current status, because main may have started watching before the window
 * finished loading and heard the event.
 */

import { useSyncExternalStore } from 'react'

export type WorkspaceStatusValue = TapestryWorkspaceStatusValue

export interface WorkspaceStatusLine {
  text: string
  tone: 'muted' | 'destructive'
}

/** What the header's status slot says for a status; null before one is known. */
export function workspaceStatusLine(status: WorkspaceStatusValue | null): WorkspaceStatusLine | null {
  if (!status) return null
  switch (status.kind) {
    case 'watching':
      return { text: 'Watching', tone: 'muted' }
    case 'not-watching': {
      const reason = status.reason.trim().replace(/\.+$/, '')
      return {
        text: `Not watching -- ${reason}. Tapestry will try again in 5 seconds.`,
        tone: 'destructive',
      }
    }
    case 'folder-missing':
      return { text: 'The folder is missing; nothing is being recorded.', tone: 'destructive' }
  }
}

// ---------------------------------------------------------------------------
// The per-tree last status
// ---------------------------------------------------------------------------

const lastStatus = new Map<string, WorkspaceStatusValue>()
/** Trees whose status arrived as an event, which a late snapshot must not overwrite. */
const heard = new Set<string>()
const listeners = new Set<() => void>()
let subscribed = false

function strip(event: TapestryWorkspaceStatus): WorkspaceStatusValue {
  const { treeId: _treeId, ...status } = event
  return status as WorkspaceStatusValue
}

function notify(): void {
  for (const listener of listeners) listener()
}

/** Record a status event. Exported for tests; the subscription calls it. */
export function recordWorkspaceStatus(event: TapestryWorkspaceStatus): void {
  heard.add(event.treeId)
  lastStatus.set(event.treeId, strip(event))
  notify()
}

/** The last status a tree reported, or null. */
export function workspaceStatusFor(treeId: string): WorkspaceStatusValue | null {
  return lastStatus.get(treeId) ?? null
}

function ensureSubscribed(): void {
  if (subscribed) return
  if (typeof window === 'undefined' || !window.tapestry?.onWorkspaceStatus) return
  subscribed = true
  window.tapestry.onWorkspaceStatus(recordWorkspaceStatus)
  void window.tapestry.workspace
    .statuses()
    .then((statuses) => {
      let changed = false
      for (const event of statuses) {
        if (heard.has(event.treeId)) continue
        lastStatus.set(event.treeId, strip(event))
        changed = true
      }
      if (changed) notify()
    })
    .catch(() => undefined)
}

function subscribe(listener: () => void): () => void {
  ensureSubscribed()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** A workspace tree's watching status, live; null until main has said. */
export function useWorkspaceStatus(treeId: string): WorkspaceStatusValue | null {
  return useSyncExternalStore(subscribe, () => workspaceStatusFor(treeId))
}
