/**
 * A recursive folder watcher that produces dirty-path hints (02.7 D-06).
 *
 * **A hint only.** Nothing here decides what changed: events are dropped,
 * merged and reordered by every platform, so each one only says "look at
 * this path again". The reconciler reads the folder and compares hashes
 * (02.2 RESEARCH Pattern 3), which is what makes a missed or duplicated event
 * harmless.
 *
 * Built on recursive `fs.watch`, so it needs no dependency.
 * On macOS, Node 20 (Electron 32) implements recursive watching with native
 * FSEvents, which reports changes under the real folder tree and does not
 * traverse symbolic links to directories: a link to `~/.ssh` inside a
 * workspace produces no events from inside `~/.ssh` (T-02.7-24). `FolderWatcher`
 * is an interface so a vault that needs chokidar can put it behind the same
 * shape (02.2 Plan 10).
 */

import { watch } from 'fs'
import { TAPESTRY_TMP_MARKER } from './atomic-write'

export interface FolderWatcher {
  close(): void
}

export interface FolderWatcherHandlers {
  /** Folder-relative posix paths to look at again, or 'all' when unknown. */
  onDirty(rels: string[] | 'all'): void
  onError(err: Error): void
  /** Extra paths to drop, on top of the default noise. */
  isNoise?(rel: string): boolean
}

export type CreateFolderWatcher = (root: string, handlers: FolderWatcherHandlers) => FolderWatcher

/**
 * Paths no mirror records, dropped before they become hints: anything inside
 * `.git` (at any depth, any case), a top-level `node_modules`, and Tapestry's
 * own atomic-write temp files.
 */
export function isWatchNoise(rel: string): boolean {
  const segments = rel.split('/')
  if (segments[0] === 'node_modules') return true
  for (const segment of segments) {
    if (segment.toLowerCase() === '.git') return true
    if (segment.includes(TAPESTRY_TMP_MARKER)) return true
  }
  return false
}

/** An event's filename as a folder-relative posix path, or null when there is none. */
function toRel(filename: string | Buffer | null): string | null {
  if (filename === null || filename === undefined) return null
  let rel = typeof filename === 'string' ? filename : filename.toString('utf-8')
  rel = rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  return rel.length > 0 ? rel : null
}

/**
 * Watch `root` recursively. Throws when the folder cannot be watched (for
 * example, when it does not exist); later failures go to `onError`.
 */
export function createFolderWatcher(root: string, handlers: FolderWatcherHandlers): FolderWatcher {
  let closed = false
  const watcher = watch(root, { recursive: true, persistent: true }, (_event, filename) => {
    if (closed) return
    const rel = toRel(filename)
    if (rel === null) {
      handlers.onDirty('all')
      return
    }
    if (isWatchNoise(rel) || handlers.isNoise?.(rel)) return
    const cut = rel.lastIndexOf('/')
    handlers.onDirty(cut === -1 ? [rel] : [rel, rel.slice(0, cut)])
  })
  watcher.on('error', (err) => {
    if (closed) return
    handlers.onError(err instanceof Error ? err : new Error(String(err)))
  })
  return {
    close(): void {
      if (closed) return
      closed = true
      watcher.close()
    },
  }
}
