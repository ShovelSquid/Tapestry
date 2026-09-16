/**
 * Main Tapestry application -- the space, holding one frame per open tree
 * (D-15) on a full-window 2D canvas.
 *
 * App owns the data layer through useForest: which trees are open, each one's
 * nodes, edges, provenance and save state. Canvas owns the view. Every handler
 * here names a note by NodeRef (tree + node), because a node id alone is only
 * unique inside one tree.
 *
 * Double-clicking empty space inside a frame creates a note in that tree
 * (D-04). Double-clicking outside every frame creates nothing (UA-06): a note
 * has to belong to a tree.
 *
 * Save state tracking (D-02) is per tree, in useForest:
 * - "Saving..." while any of that tree's notes has a debounce timer active OR
 *   an IPC call in flight
 * - "Saved" only when both are empty
 * - "Not saved" after a failed call
 */

import React, { useCallback, useEffect, useState } from 'react'
import Canvas, { type DoubleClickTarget } from './components/Canvas'
import ForestBar from './components/ForestBar'
import TransientNotice from './components/TransientNotice'
import PluginErrorNotification from './components/PluginErrorNotification'
import NamePromptDialog from './components/NamePromptDialog'
import { useForest, type NodeRef } from './state/use-forest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A note's title, derived from its file name, for a newly created world. */
function worldNameFromPath(filePath: string): string {
  const fileName = filePath.split('/').pop()?.replace(/\.tree$/, '') ?? 'untitled'
  return fileName.replace(/[^A-Za-z0-9_-]/g, '_')
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App(): React.ReactElement {
  const {
    trees,
    lastChangedTreeId,
    patchNodeProps,
    refreshTree,
    refreshAll,
    submitChange,
    markDirty,
    markClean,
  } = useForest()

  const [editingRef, setEditingRef] = useState<NodeRef | null>(null)
  const [selectedRef, setSelectedRef] = useState<NodeRef | null>(null)

  // The name every change is signed with (D-07). Null means "not chosen yet",
  // which is what makes the first-run prompt appear; nameLoaded keeps the
  // prompt from flashing before settings have been read.
  const [userName, setUserName] = useState<string | null>(null)
  const [suggestedName, setSuggestedName] = useState('')
  const [nameLoaded, setNameLoaded] = useState(false)

  // Agents (D-03/D-06). One copy of the list and the switch lives here, so
  // the forest bar's label and the panel's rows can never disagree.
  const [agents, setAgents] = useState<TapestryAgentSummary[]>([])
  const [agentsEnabled, setAgentsEnabled] = useState(true)

  // A passing message about something that already happened (UA-14).
  const [notice, setNotice] = useState<string | null>(null)

  // Plugin contributions: maps node types to component names from plugins
  const [pluginNodeViews, setPluginNodeViews] = useState<Record<string, string>>({})

  // Plugin error notification state (D-34)
  const [pluginError, setPluginError] = useState<{
    /** Plugin id used for reload — never the display name. */
    pluginName: string
    displayName: string
    message: string
    canRestart: boolean
  } | null>(null)

  /**
   * Surface an application-level error through the notification banner
   * (reused from the plugin crash UI). Kernel rejections — a commit refused
   * while history is rewound, a world that will not open — must not disappear
   * into the console.
   */
  const showAppError = useCallback((message: string) => {
    setPluginError({ pluginName: 'tapestry', displayName: 'Tapestry', message, canRestart: false })
  }, [])

  /** Log a failed save and tell the user why. The indicator is already set. */
  const reportSaveError = useCallback(
    (action: string, err: unknown) => {
      console.error(`${action}:`, err)
      showAppError(`${action}: ${errorMessage(err)}`)
    },
    [showAppError],
  )

  // -----------------------------------------------------------------------
  // Plugins and agents
  // -----------------------------------------------------------------------

  const refreshPluginContributions = useCallback(async () => {
    try {
      const contributions = await window.tapestry.plugins.getContributions()
      const views: Record<string, string> = {}
      for (const [nodeType, contrib] of Object.entries(contributions.nodeViews)) {
        views[nodeType] = (contrib as any).component
      }
      setPluginNodeViews(views)
    } catch {
      // Plugins not available yet — empty views
    }
  }, [])

  /** Re-read who may connect and who is connected right now. */
  const refreshAgents = useCallback(async () => {
    try {
      const [list, enabled] = await Promise.all([
        window.tapestry.agents.list(),
        window.tapestry.agents.getEnabled(),
      ])
      setAgents(list)
      setAgentsEnabled(enabled)
    } catch {
      // The bridge is unavailable: show no agents rather than stale ones.
      setAgents([])
    }
  }, [])

  useEffect(() => {
    refreshPluginContributions()

    // Listen for plugin error notifications (D-34)
    const removePluginError = window.tapestry.onPluginError(
      (pluginName, displayName, message, canRestart) => {
        // An empty message means the automatic restart succeeded — the
        // notification shows a brief success state and then auto-dismisses.
        setPluginError({ pluginName, displayName, message, canRestart })
      },
    )

    return () => removePluginError()
  }, [refreshPluginContributions])

  useEffect(() => {
    refreshAgents()

    const removeAgentsChanged = window.tapestry.onAgentsChanged(() => {
      refreshAgents()
    })

    // An agent wrote into a tree Kaelen had rewound. The write has already
    // landed and the redo is already gone, so this is a notice about something
    // that happened, not a question — losing redo silently is the failure this
    // exists to prevent.
    const removeRedoDiscarded = window.tapestry.onRedoDiscarded(({ treeId, treeName, actorId }) => {
      refreshTree(treeId)
      const name = actorId.replace(/^agent\./, '')
      setNotice(`agent.${name} added a change to ${treeName}, so redo is no longer available.`)
    })

    return () => {
      removeAgentsChanged()
      removeRedoDiscarded()
    }
  }, [refreshAgents, refreshTree])

  // -----------------------------------------------------------------------
  // User name (D-07)
  // -----------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false
    window.tapestry.settings
      .getUserName()
      .then(({ userName: stored, suggested }) => {
        if (cancelled) return
        setUserName(stored)
        setSuggestedName(suggested)
      })
      .catch(() => {
        // Settings unreadable: fall through to the prompt rather than letting
        // changes be made under an unknown name.
        if (!cancelled) setSuggestedName('')
      })
      .finally(() => {
        if (!cancelled) setNameLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Save the chosen name; resolves to an error to display, or null. */
  const handleSaveUserName = useCallback(async (name: string): Promise<string | null> => {
    const result = await window.tapestry.settings.setUserName(name)
    if (result.ok) {
      setUserName(name)
      return null
    }
    return result.error ?? 'Could not save your name.'
  }, [])

  // -----------------------------------------------------------------------
  // Create note on double-click (D-04)
  // -----------------------------------------------------------------------

  const createNote = useCallback(
    async (treeId: string, x: number, y: number) => {
      try {
        const commitResult = await submitChange(treeId, 'Create note', [
          {
            op: 'createNode',
            type: 'tapestry.notes/note@1',
            props: {
              'position.x': { type: 'real', value: x },
              'position.y': { type: 'real', value: y },
              body: { type: 'text', value: '' },
              title: { type: 'text', value: '' },
            },
          },
        ])

        await refreshTree(treeId)

        if (commitResult.nodeIds && commitResult.nodeIds.length > 0) {
          setEditingRef({ treeId, nodeId: commitResult.nodeIds[0] })
        }
      } catch (err) {
        reportSaveError('Failed to create note', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  const handleCanvasDoubleClick = useCallback(
    async (target: DoubleClickTarget) => {
      // Inside a frame: the note belongs to that tree, at frame-local coords.
      if (target.treeId) {
        await createNote(target.treeId, target.x, target.y)
        return
      }

      // No tree open at all: ask where to save, create the world, then put the
      // first note at its origin.
      const result = await window.tapestry.dialog.showSave()
      if (result.canceled || !result.filePath) return

      const created = await window.tapestry.trees.create(
        result.filePath,
        worldNameFromPath(result.filePath),
      )
      if (!created.ok || !created.treeId) {
        // Show the reason (invalid location, file already exists, ...) instead
        // of silently doing nothing on double-click.
        showAppError(`Could not create world: ${created.error ?? 'unknown error'}`)
        return
      }

      // The new tree has to be in local state before a note can go into it.
      await refreshAll()
      await createNote(created.treeId, 0, 0)
    },
    [createNote, refreshAll, showAppError],
  )

  // -----------------------------------------------------------------------
  // Note edits. Each names its tree, so a commit lands in one journal.
  // -----------------------------------------------------------------------

  const handlePositionChange = useCallback(
    async (ref: NodeRef, newX: number, newY: number) => {
      try {
        await submitChange(ref.treeId, 'Move note', [
          { op: 'setProperty', target: ref.nodeId, key: 'position.x', type: 'real', value: newX },
          { op: 'setProperty', target: ref.nodeId, key: 'position.y', type: 'real', value: newY },
        ])
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to update position', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  /** Thread center pin (D-17): position + pinned=true in one commit. */
  const handlePinnedPositionChange = useCallback(
    async (ref: NodeRef, newX: number, newY: number) => {
      try {
        await submitChange(ref.treeId, 'Pin thread center', [
          { op: 'setProperty', target: ref.nodeId, key: 'position.x', type: 'real', value: newX },
          { op: 'setProperty', target: ref.nodeId, key: 'position.y', type: 'real', value: newY },
          { op: 'setProperty', target: ref.nodeId, key: 'pinned', type: 'bool', value: true },
        ])
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to pin thread center', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  const handleWidthChange = useCallback(
    async (ref: NodeRef, newWidth: number) => {
      try {
        await submitChange(ref.treeId, 'Resize note', [
          { op: 'setProperty', target: ref.nodeId, key: 'width', type: 'real', value: newWidth },
        ])
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to update width', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  const handleHeightChange = useCallback(
    async (ref: NodeRef, newHeight: number) => {
      try {
        await submitChange(ref.treeId, 'Resize note height', [
          { op: 'setProperty', target: ref.nodeId, key: 'height', type: 'real', value: newHeight },
        ])
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to update height', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  const handleEdgeCreate = useCallback(
    async (from: NodeRef, to: NodeRef) => {
      // Canvas only offers same-tree connections; this is the second guard.
      if (from.treeId !== to.treeId) return
      try {
        await submitChange(from.treeId, 'Connect notes', [
          { op: 'createEdge', from: from.nodeId, to: to.nodeId, label: 'link' },
        ])
        await refreshTree(from.treeId)
      } catch (err) {
        reportSaveError('Failed to create edge', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  const handleNoteSave = useCallback(
    async (ref: NodeRef, body: string, title: string): Promise<void> => {
      try {
        await submitChange(ref.treeId, 'Update note text', [
          { op: 'setProperty', target: ref.nodeId, key: 'body', type: 'text', value: body },
          { op: 'setProperty', target: ref.nodeId, key: 'title', type: 'text', value: title },
        ])

        // Mirror the saved values locally so the NoteCard `body` prop does not
        // lag the kernel. A stale prop would later look like an external
        // change and reset the editor mid-typing.
        patchNodeProps(ref, {
          body: { type: 'text', value: body },
          title: { type: 'text', value: title },
        })
      } catch (err) {
        reportSaveError('Failed to save note', err)
      }
    },
    [submitChange, patchNodeProps, reportSaveError],
  )

  /** Fallback property edit (D-35: disabled plugin content stays editable). */
  const handlePropertyEdit = useCallback(
    async (
      ref: NodeRef,
      key: string,
      type: string,
      value: string | number | boolean,
    ): Promise<void> => {
      try {
        await submitChange(ref.treeId, `Edit property ${key}`, [
          { op: 'setProperty', target: ref.nodeId, key, type, value },
        ])
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to edit property', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  const handleDeleteNote = useCallback(
    async (ref: NodeRef) => {
      try {
        await submitChange(ref.treeId, 'Delete note', [{ op: 'deleteNode', id: ref.nodeId }])

        setEditingRef((prev) =>
          prev && prev.treeId === ref.treeId && prev.nodeId === ref.nodeId ? null : prev,
        )

        // Edges touching the deleted node are cascaded, so the whole tree is
        // re-read rather than just its nodes.
        await refreshTree(ref.treeId)
      } catch (err) {
        reportSaveError('Failed to delete note', err)
      }
    },
    [submitChange, refreshTree, reportSaveError],
  )

  // -----------------------------------------------------------------------
  // Plugin error handlers (D-34)
  // -----------------------------------------------------------------------

  const handlePluginRestart = useCallback(
    async (pluginName: string) => {
      // reload() resolves with a status rather than throwing on failure; only
      // a 'loaded' result means the restart actually worked.
      try {
        const result = await window.tapestry.plugins.reload(pluginName)
        if (result.status === 'loaded') {
          setPluginError(null)
          await refreshPluginContributions()
        } else {
          setPluginError(
            (prev) =>
              prev && {
                ...prev,
                message: `${prev.displayName} could not restart: ${result.reason ?? result.status}`,
                canRestart: true,
              },
          )
        }
      } catch (err) {
        console.error('Failed to restart plugin:', err)
        setPluginError(
          (prev) =>
            prev && {
              ...prev,
              message: `${prev.displayName} could not restart: ${errorMessage(err)}`,
              canRestart: true,
            },
        )
      }
    },
    [refreshPluginContributions],
  )

  const handlePluginErrorDismiss = useCallback(() => {
    setPluginError(null)
  }, [])

  // -----------------------------------------------------------------------
  // Undo/Redo (D-22): Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z at the window level
  // -----------------------------------------------------------------------

  /**
   * Which tree undo acts on.
   *
   * History is per journal, so "undo" has to mean one tree. The note being
   * edited or selected is the clearest statement of what the person is working
   * on; with nothing selected, the tree they last changed is the next best
   * answer, and the only open tree is the answer when there is just one.
   */
  const undoTargetTreeId =
    editingRef?.treeId ?? selectedRef?.treeId ?? lastChangedTreeId ?? trees[0]?.id ?? null

  const handleUndo = useCallback(async () => {
    if (!undoTargetTreeId) return
    try {
      const result = await window.tapestry.kernel.undo(undoTargetTreeId)
      if (result.ok) {
        setEditingRef(null)
        await refreshTree(undoTargetTreeId)
      }
    } catch (err) {
      console.error('Undo failed:', err)
      showAppError(`Undo failed: ${errorMessage(err)}`)
    }
  }, [undoTargetTreeId, refreshTree, showAppError])

  const handleRedo = useCallback(async () => {
    if (!undoTargetTreeId) return
    try {
      const result = await window.tapestry.kernel.redo(undoTargetTreeId)
      if (result.ok) {
        setEditingRef(null)
        await refreshTree(undoTargetTreeId)
      }
    } catch (err) {
      console.error('Redo failed:', err)
      showAppError(`Redo failed: ${errorMessage(err)}`)
    }
  }, [undoTargetTreeId, refreshTree, showAppError])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingRef(null)
        return
      }

      // Cmd/Ctrl+Z for undo, Cmd/Ctrl+Shift+Z for redo (D-22). When
      // ProseMirror has focus, let it handle undo/redo for uncommitted text.
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'z') {
        const active = document.activeElement
        if (active && active.closest('.ProseMirror')) return

        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleUndo, handleRedo])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  // The actor id this person's own changes are signed with (D-07). Null until
  // a name exists, which is exactly while the first-run prompt is up.
  const currentUserActorId = userName !== null ? `user.${userName}` : null

  // Until Plan 06 moves save state into each frame header, the forest bar
  // still shows one tree's: the most recently opened, which is the tree the
  // single-world flow would have had open anyway.
  const primaryTree = trees.length > 0 ? trees[trees.length - 1] : null

  return (
    <div className="tapestry-app">
      {/* Top-left chrome: save state, agents, and the name changes are signed
          with. Plan 06 moves save state into per-frame headers. */}
      <ForestBar
        filePath={primaryTree?.path ?? null}
        saveState={primaryTree?.saveState ?? 'saved'}
        agents={agents}
        agentsEnabled={agentsEnabled}
        userName={userName}
        onSaveUserName={handleSaveUserName}
        onAgentsRefresh={refreshAgents}
      />

      {/* An agent write ended a rewound state (UA-14) */}
      {notice && <TransientNotice message={notice} onHide={() => setNotice(null)} />}

      {/* Plugin error notification (D-34) */}
      {pluginError && (
        <PluginErrorNotification
          pluginName={pluginError.pluginName}
          displayName={pluginError.displayName}
          message={pluginError.message}
          canRestart={pluginError.canRestart}
          onRestart={handlePluginRestart}
          onDismiss={handlePluginErrorDismiss}
        />
      )}

      {/* First-run name prompt (D-07). Its overlay covers the canvas, so no
          change can be made before a name exists to sign it with. */}
      {nameLoaded && userName === null && (
        <NamePromptDialog
          mode="first-run"
          initialName={suggestedName}
          onSave={handleSaveUserName}
        />
      )}

      {/* The space: one frame per open tree, with pan/zoom and connections */}
      <Canvas
        trees={trees}
        editingRef={editingRef}
        pluginNodeViews={pluginNodeViews}
        currentUserActorId={currentUserActorId}
        onStartEditing={(ref) => setEditingRef(ref)}
        onStopEditing={() => setEditingRef(null)}
        onCanvasDoubleClick={handleCanvasDoubleClick}
        onSelectedNoteChange={setSelectedRef}
        onSave={handleNoteSave}
        onMarkDirty={markDirty}
        onMarkClean={markClean}
        onPositionChange={handlePositionChange}
        onWidthChange={handleWidthChange}
        onHeightChange={handleHeightChange}
        onPinnedPositionChange={handlePinnedPositionChange}
        onEdgeCreate={handleEdgeCreate}
        onDeleteNote={handleDeleteNote}
        onPropertyEdit={handlePropertyEdit}
      />
    </div>
  )
}
