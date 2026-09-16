/**
 * useForest — the renderer's copy of the trees in the space (D-15, D-18).
 *
 * Phase 2 held one world's nodes, edges, history and save state directly in
 * App. Several trees share one space now, so each of those becomes per-tree:
 * a commit belongs to one journal, and a save indicator that averaged two
 * trees would say "Saved" while another tree was still writing.
 *
 * Two performance rules are load-bearing rather than tidy:
 *  - The journal is never reopened here. Trees are opened once in main and
 *    addressed by id; these calls are lookups, not opens.
 *  - Provenance (getHistoryIndex) scans the journal, which is linear in the
 *    number of commits, so it is debounced and runs only for the trees whose
 *    graph actually changed. Refreshing every tree's history on every commit
 *    is what makes a long history feel slow.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EdgeInfo, NodeInfo } from '../components/Canvas'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A node, qualified by the tree it lives in.
 *
 * Node ids (`n1`, `n2`) are only unique inside one tree, so every piece of
 * per-note UI state and every handler takes the pair. Using a bare node id
 * across trees would silently address the wrong note.
 */
export interface NodeRef {
  treeId: string
  nodeId: string
}

/** A stable string key for a NodeRef, for Maps, Sets and React keys. */
export function nodeKey(ref: NodeRef): string {
  return `${ref.treeId}|${ref.nodeId}`
}

export type TreeSaveState = 'saved' | 'saving' | 'error'

/** One tree in the space, with everything needed to draw its frame. */
export interface ForestTree {
  id: string
  name: string
  kind: 'native' | 'vault'
  path: string
  vaultRoot?: string
  /** Where the frame's local origin sits in world space. */
  frame: { x: number; y: number }
  nodes: NodeInfo[]
  edges: EdgeInfo[]
  history: TapestryHistoryIndex | null
  saveState: TreeSaveState
}

/** How long to wait after a graph change before rescanning the journal. */
const HISTORY_DEBOUNCE_MS = 300

// ---------------------------------------------------------------------------
// useForest
// ---------------------------------------------------------------------------

export function useForest() {
  const [trees, setTrees] = useState<ForestTree[]>([])

  /**
   * A mirror of `trees` that is current synchronously.
   *
   * Several updates can land between renders (a list refresh followed by a
   * per-tree refresh), and reading stale state in those callbacks would drop
   * one of them.
   */
  const treesRef = useRef<ForestTree[]>([])

  const applyTrees = useCallback((fn: (prev: ForestTree[]) => ForestTree[]) => {
    const next = fn(treesRef.current)
    treesRef.current = next
    setTrees(next)
  }, [])

  const patchTree = useCallback(
    (treeId: string, patch: (tree: ForestTree) => ForestTree) => {
      applyTrees((prev) => prev.map((tree) => (tree.id === treeId ? patch(tree) : tree)))
    },
    [applyTrees],
  )

  // Per-tree save bookkeeping, mirroring the D-02 contract one tree at a time:
  // notes whose debounce timer is still running, and calls still in flight.
  const dirtyRef = useRef(new Map<string, Set<string>>())
  const pendingRef = useRef(new Map<string, number>())

  /** The tree the last change landed in — the undo/redo target with no selection. */
  const [lastChangedTreeId, setLastChangedTreeId] = useState<string | null>(null)

  const setSaveState = useCallback(
    (treeId: string, saveState: TreeSaveState) => {
      patchTree(treeId, (tree) => (tree.saveState === saveState ? tree : { ...tree, saveState }))
    },
    [patchTree],
  )

  /** "Saved" only when no timer is pending AND no call is in flight (D-02). */
  const recomputeSaveState = useCallback(
    (treeId: string) => {
      const dirty = dirtyRef.current.get(treeId)?.size ?? 0
      const pending = pendingRef.current.get(treeId) ?? 0
      setSaveState(treeId, dirty > 0 || pending > 0 ? 'saving' : 'saved')
    },
    [setSaveState],
  )

  const addPending = useCallback((treeId: string, delta: number) => {
    const next = Math.max(0, (pendingRef.current.get(treeId) ?? 0) + delta)
    pendingRef.current.set(treeId, next)
  }, [])

  // -------------------------------------------------------------------------
  // Provenance, debounced per tree
  // -------------------------------------------------------------------------

  const historyDirtyRef = useRef(new Set<string>())
  const [graphVersion, setGraphVersion] = useState(0)

  const markHistoryStale = useCallback((treeId: string) => {
    historyDirtyRef.current.add(treeId)
    setGraphVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    if (historyDirtyRef.current.size === 0) return

    const timer = setTimeout(() => {
      const ids = [...historyDirtyRef.current]
      historyDirtyRef.current.clear()

      for (const treeId of ids) {
        window.tapestry.kernel
          .getHistoryIndex(treeId)
          .then((history) => {
            patchTree(treeId, (tree) => ({ ...tree, history }))
          })
          .catch(() => {
            // Show no provenance rather than stale provenance.
            patchTree(treeId, (tree) => ({ ...tree, history: null }))
          })
      }
    }, HISTORY_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [graphVersion, patchTree])

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * Re-read which trees are open, keeping what we already know about each.
   *
   * A tree that is still open keeps its nodes, edges, history and save state:
   * the list changing (one tree opened) must not blank every other frame.
   */
  const refreshTreeList = useCallback(async (): Promise<TapestryTreeSummary[]> => {
    let list: TapestryTreeSummary[] = []
    try {
      list = (await window.tapestry.trees.list()) ?? []
    } catch {
      list = []
    }

    applyTrees((prev) => {
      const known = new Map(prev.map((tree) => [tree.id, tree]))
      return list.map((summary) => {
        const existing = known.get(summary.id)
        if (existing) {
          return {
            ...existing,
            name: summary.name,
            kind: summary.kind,
            path: summary.path,
            vaultRoot: summary.vaultRoot,
            frame: summary.frame,
          }
        }
        return {
          id: summary.id,
          name: summary.name,
          kind: summary.kind,
          path: summary.path,
          vaultRoot: summary.vaultRoot,
          frame: summary.frame,
          nodes: [],
          edges: [],
          history: null,
          saveState: 'saved' as TreeSaveState,
        }
      })
    })

    return list
  }, [applyTrees])

  /** Re-read one tree's graph. Its provenance follows, debounced. */
  const refreshTree = useCallback(
    async (treeId: string) => {
      try {
        const [nodes, edges] = await Promise.all([
          window.tapestry.kernel.getNodes(treeId),
          window.tapestry.kernel.getEdges(treeId),
        ])
        patchTree(treeId, (tree) => ({ ...tree, nodes: nodes ?? [], edges: edges ?? [] }))
      } catch {
        patchTree(treeId, (tree) => ({ ...tree, nodes: [], edges: [] }))
      }
      markHistoryStale(treeId)
    },
    [patchTree, markHistoryStale],
  )

  /** Re-read the list and every tree's graph. */
  const refreshAll = useCallback(async () => {
    const list = await refreshTreeList()
    await Promise.all(list.map((summary) => refreshTree(summary.id)))
  }, [refreshTreeList, refreshTree])

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /**
   * Submit a change to one tree.
   *
   * The renderer names the change, the operations and the tree; it never names
   * who made it. Main stamps `human user.<name>` (D-06/D-07). Errors are
   * re-thrown after the indicator is set, so the caller can say what failed.
   */
  const submitChange = useCallback(
    async (treeId: string, message: string, ops: any[]) => {
      addPending(treeId, 1)
      setSaveState(treeId, 'saving')

      try {
        const result = await window.tapestry.kernel.submit(treeId, message, ops)
        addPending(treeId, -1)
        recomputeSaveState(treeId)
        markHistoryStale(treeId)
        setLastChangedTreeId(treeId)
        return result
      } catch (err) {
        addPending(treeId, -1)
        setSaveState(treeId, 'error')
        throw err
      }
    },
    [addPending, setSaveState, recomputeSaveState, markHistoryStale],
  )

  /** A note's text changed but its debounce timer has not fired yet. */
  const markDirty = useCallback(
    (ref: NodeRef) => {
      const dirty = dirtyRef.current.get(ref.treeId) ?? new Set<string>()
      dirty.add(ref.nodeId)
      dirtyRef.current.set(ref.treeId, dirty)
      recomputeSaveState(ref.treeId)
    },
    [recomputeSaveState],
  )

  const markClean = useCallback((ref: NodeRef) => {
    dirtyRef.current.get(ref.treeId)?.delete(ref.nodeId)
  }, [])

  /**
   * Move a frame in the renderer only.
   *
   * Used while dragging and while push-apart settles; the caller persists the
   * final positions with `trees.setFrame` so a drag is one write, not sixty.
   */
  const setFrameLocal = useCallback(
    (treeId: string, x: number, y: number) => {
      patchTree(treeId, (tree) => ({ ...tree, frame: { x, y } }))
    },
    [patchTree],
  )

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  useEffect(() => {
    refreshAll()

    // The space changed: a tree opened or closed, or launch restored it.
    const removeTreesChanged = window.tapestry.onTreesChanged(() => {
      refreshAll()
    })

    // A commit landed from outside this window (an agent, a plugin). Only the
    // tree it landed in is re-read.
    const removeTreeChanged = window.tapestry.onTreeChanged((treeId: string) => {
      refreshTree(treeId)
    })

    return () => {
      removeTreesChanged()
      removeTreeChanged()
    }
  }, [refreshAll, refreshTree])

  /**
   * Mirror values that have just been committed into local state.
   *
   * Without this, a note's `body` prop would lag the kernel until the next
   * full refresh, and the stale value would later look like an external change
   * and reset the editor mid-typing. Re-reading the tree instead would race
   * with continued typing and produce the same reset.
   */
  const patchNodeProps = useCallback(
    (
      ref: NodeRef,
      props: Record<string, { type: string; value: string | number | boolean }>,
    ) => {
      patchTree(ref.treeId, (tree) => ({
        ...tree,
        nodes: tree.nodes.map((node) =>
          node.id === ref.nodeId ? { ...node, props: { ...node.props, ...props } } : node,
        ),
      }))
    },
    [patchTree],
  )

  return {
    trees,
    lastChangedTreeId,
    patchNodeProps,
    refreshTreeList,
    refreshTree,
    refreshAll,
    submitChange,
    markDirty,
    markClean,
    setFrameLocal,
  }
}
