/**
 * Main Tapestry application -- renders a full-window 2D canvas (D-05)
 * with notes positioned at their world-space coordinates.
 *
 * The Canvas component (Plan 03) handles pan/zoom, drag-to-reposition,
 * connection display, and hover controls. This App component owns the
 * data layer: nodes, edges, save state, file lifecycle.
 *
 * Double-clicking empty canvas space creates a new note (D-04).
 * Notes are rendered as NoteCard components with ProseMirror editing.
 *
 * Save state tracking (D-02):
 * - "Saving..." when any note has a debounce timer active OR an IPC call in-flight
 * - "Saved" only when ALL debounce timers have fired AND all IPC calls have completed
 * - "Not saved" when the last IPC call failed
 * The indicator never shows "Saved" while a debounce timer is still active.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Canvas, { type NodeInfo, type EdgeInfo } from './components/Canvas'
import SaveIndicator from './components/SaveIndicator'
import PluginErrorNotification from './components/PluginErrorNotification'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SaveState = 'saved' | 'saving' | 'error'

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App(): React.ReactElement {
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [edges, setEdges] = useState<EdgeInfo[]>([])
  const [filePath, setFilePath] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [isFileLoaded, setIsFileLoaded] = useState(false)

  // Plugin contributions: maps node types to component names from loaded plugins
  const [pluginNodeViews, setPluginNodeViews] = useState<Record<string, string>>({})

  // Plugin error notification state (D-34)
  const [pluginError, setPluginError] = useState<{
    pluginName: string
    message: string
    canRestart: boolean
  } | null>(null)

  // Track pending debounced saves (IPC calls in-flight)
  const pendingSavesRef = useRef(0)
  // Track notes with active debounce timers (text changed but not yet submitted)
  const dirtyNotesRef = useRef(new Set<string>())

  /**
   * Recompute save state from the two sources of truth:
   * - dirtyNotesRef: notes with active debounce timers
   * - pendingSavesRef: IPC calls currently in-flight
   * Only shows "Saved" when BOTH are empty.
   */
  const recomputeSaveState = useCallback(() => {
    if (dirtyNotesRef.current.size > 0 || pendingSavesRef.current > 0) {
      setSaveState('saving')
    } else {
      setSaveState('saved')
    }
  }, [])

  // -----------------------------------------------------------------------
  // Load state on mount
  // -----------------------------------------------------------------------

  const refreshNodes = useCallback(async () => {
    try {
      const nodeList = await window.tapestry.kernel.getNodes()
      setNodes(nodeList || [])
    } catch {
      setNodes([])
    }
  }, [])

  const refreshEdges = useCallback(async () => {
    try {
      const edgeList = await window.tapestry.kernel.getEdges()
      setEdges(edgeList || [])
    } catch {
      setEdges([])
    }
  }, [])

  const refreshFilePath = useCallback(async () => {
    try {
      const path = await window.tapestry.kernel.getFilePath()
      setFilePath(path)
      if (path) setIsFileLoaded(true)
    } catch {
      setFilePath(null)
    }
  }, [])

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

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshNodes(), refreshEdges(), refreshPluginContributions()])
  }, [refreshNodes, refreshEdges, refreshPluginContributions])

  useEffect(() => {
    refreshFilePath().then(() => refreshAll())

    const removeFileOpened = window.tapestry.onFileOpened((path: string) => {
      setFilePath(path)
      setIsFileLoaded(true)
      refreshAll()
    })

    // Listen for plugin error notifications (D-34)
    const removePluginError = window.tapestry.onPluginError((pluginName, message, canRestart) => {
      if (!message) {
        // Empty message means restart succeeded — show brief success then dismiss
        setPluginError({ pluginName, message: '', canRestart: false })
      } else {
        setPluginError({ pluginName, message, canRestart })
      }
    })

    return () => {
      removeFileOpened()
      removePluginError()
    }
  }, [refreshAll, refreshFilePath])

  // -----------------------------------------------------------------------
  // Create note on double-click (D-04)
  // -----------------------------------------------------------------------

  const handleCanvasDoubleClick = useCallback(
    async (worldX: number, worldY: number) => {
      // If no file is loaded, prompt for a save location first
      if (!isFileLoaded) {
        const result = await window.tapestry.dialog.showSave()
        if (result.canceled || !result.filePath) return

        try {
          await window.tapestry.kernel.create(result.filePath, 'My World')
          setFilePath(result.filePath)
          setIsFileLoaded(true)
        } catch (err) {
          console.error('Failed to create world:', err)
          return
        }
      }

      // Create a new note node at the world-space click position
      try {
        setSaveState('saving')
        const commitResult = await window.tapestry.kernel.submit(
          'user',
          'local',
          'Create note',
          [
            {
              op: 'createNode',
              type: 'tapestry.notes/note@1',
              props: {
                'position.x': { type: 'real', value: worldX },
                'position.y': { type: 'real', value: worldY },
                body: { type: 'text', value: '' },
                title: { type: 'text', value: '' },
              },
            },
          ],
        )

        recomputeSaveState()

        // Refresh nodes and start editing the new one
        await refreshAll()

        if (commitResult.nodeIds && commitResult.nodeIds.length > 0) {
          setEditingNodeId(commitResult.nodeIds[0])
        }
      } catch (err) {
        console.error('Failed to create note:', err)
        setSaveState('error')
      }
    },
    [isFileLoaded, recomputeSaveState, refreshAll],
  )

  // -----------------------------------------------------------------------
  // Position change handler (D-01 persistence)
  // -----------------------------------------------------------------------

  const handlePositionChange = useCallback(
    async (nodeId: string, newX: number, newY: number) => {
      pendingSavesRef.current += 1
      setSaveState('saving')

      try {
        await window.tapestry.kernel.submit(
          'user',
          'local',
          'Move note',
          [
            {
              op: 'setProperty',
              target: nodeId,
              key: 'position.x',
              type: 'real',
              value: newX,
            },
            {
              op: 'setProperty',
              target: nodeId,
              key: 'position.y',
              type: 'real',
              value: newY,
            },
          ],
        )

        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        recomputeSaveState()

        // Refresh to get confirmed positions
        await refreshNodes()
      } catch (err) {
        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        console.error('Failed to update position:', err)
        setSaveState('error')
      }
    },
    [recomputeSaveState, refreshNodes],
  )

  // -----------------------------------------------------------------------
  // Width change handler (D-08 resize persistence)
  // -----------------------------------------------------------------------

  const handleWidthChange = useCallback(
    async (nodeId: string, newWidth: number) => {
      pendingSavesRef.current += 1
      setSaveState('saving')

      try {
        await window.tapestry.kernel.submit(
          'user',
          'local',
          'Resize note',
          [
            {
              op: 'setProperty',
              target: nodeId,
              key: 'width',
              type: 'real',
              value: newWidth,
            },
          ],
        )

        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        recomputeSaveState()

        await refreshNodes()
      } catch (err) {
        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        console.error('Failed to update width:', err)
        setSaveState('error')
      }
    },
    [recomputeSaveState, refreshNodes],
  )

  // -----------------------------------------------------------------------
  // Edge creation handler
  // -----------------------------------------------------------------------

  const handleEdgeCreate = useCallback(
    async (fromId: string, toId: string) => {
      pendingSavesRef.current += 1
      setSaveState('saving')

      try {
        await window.tapestry.kernel.submit(
          'user',
          'local',
          'Connect notes',
          [
            {
              op: 'createEdge',
              from: fromId,
              to: toId,
              label: 'link',
            },
          ],
        )

        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        recomputeSaveState()

        await refreshEdges()
      } catch (err) {
        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        console.error('Failed to create edge:', err)
        setSaveState('error')
      }
    },
    [recomputeSaveState, refreshEdges],
  )

  // -----------------------------------------------------------------------
  // Debounce tracking: mark/unmark notes as dirty
  // -----------------------------------------------------------------------

  const handleMarkDirty = useCallback(
    (nodeId: string) => {
      dirtyNotesRef.current.add(nodeId)
      recomputeSaveState()
    },
    [recomputeSaveState],
  )

  const handleMarkClean = useCallback(
    (nodeId: string) => {
      dirtyNotesRef.current.delete(nodeId)
    },
    [],
  )

  // -----------------------------------------------------------------------
  // Save callback for NoteCard debounced updates
  // -----------------------------------------------------------------------

  const handleNoteSave = useCallback(
    async (
      nodeId: string,
      body: string,
      title: string,
    ): Promise<void> => {
      pendingSavesRef.current += 1
      setSaveState('saving')

      try {
        await window.tapestry.kernel.submit(
          'user',
          'local',
          'Update note text',
          [
            {
              op: 'setProperty',
              target: nodeId,
              key: 'body',
              type: 'text',
              value: body,
            },
            {
              op: 'setProperty',
              target: nodeId,
              key: 'title',
              type: 'text',
              value: title,
            },
          ],
        )

        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        recomputeSaveState()
      } catch (err) {
        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        console.error('Failed to save note:', err)
        setSaveState('error')
      }
    },
    [recomputeSaveState],
  )

  // -----------------------------------------------------------------------
  // Fallback property edit handler (D-35: disabled plugin content editable)
  // -----------------------------------------------------------------------

  const handlePropertyEdit = useCallback(
    async (
      nodeId: string,
      key: string,
      type: string,
      value: string | number | boolean,
    ): Promise<void> => {
      pendingSavesRef.current += 1
      setSaveState('saving')

      try {
        await window.tapestry.kernel.submit(
          'user',
          'local',
          `Edit property ${key}`,
          [
            {
              op: 'setProperty',
              target: nodeId,
              key,
              type,
              value,
            },
          ],
        )

        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        recomputeSaveState()
        await refreshNodes()
      } catch (err) {
        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        console.error('Failed to edit property:', err)
        setSaveState('error')
      }
    },
    [recomputeSaveState, refreshNodes],
  )

  // -----------------------------------------------------------------------
  // Plugin error handlers (D-34)
  // -----------------------------------------------------------------------

  const handlePluginRestart = useCallback(
    async (pluginName: string) => {
      try {
        await window.tapestry.plugins.reload(pluginName)
        setPluginError(null)
        await refreshPluginContributions()
      } catch (err) {
        console.error('Failed to restart plugin:', err)
      }
    },
    [refreshPluginContributions],
  )

  const handlePluginErrorDismiss = useCallback(() => {
    setPluginError(null)
  }, [])

  // -----------------------------------------------------------------------
  // Delete note handler (D-20, D-21): submit DeleteNode op
  // -----------------------------------------------------------------------

  const handleDeleteNote = useCallback(
    async (nodeId: string) => {
      pendingSavesRef.current += 1
      setSaveState('saving')

      try {
        await window.tapestry.kernel.submit(
          'user',
          'local',
          'Delete note',
          [
            {
              op: 'deleteNode',
              id: nodeId,
            },
          ],
        )

        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        recomputeSaveState()

        // If we were editing this note, stop editing
        setEditingNodeId((prev) => (prev === nodeId ? null : prev))

        // Refresh nodes and edges (edges touching the deleted node are cascaded)
        await refreshAll()
      } catch (err) {
        pendingSavesRef.current -= 1
        if (pendingSavesRef.current < 0) pendingSavesRef.current = 0
        console.error('Failed to delete note:', err)
        setSaveState('error')
      }
    },
    [recomputeSaveState, refreshAll],
  )

  // -----------------------------------------------------------------------
  // Undo/Redo (D-22): Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z at the window level
  // -----------------------------------------------------------------------

  const handleUndo = useCallback(async () => {
    try {
      const result = await window.tapestry.kernel.undo()
      if (result.ok) {
        setEditingNodeId(null)
        await refreshAll()
      }
    } catch (err) {
      console.error('Undo failed:', err)
    }
  }, [refreshAll])

  const handleRedo = useCallback(async () => {
    try {
      const result = await window.tapestry.kernel.redo()
      if (result.ok) {
        setEditingNodeId(null)
        await refreshAll()
      }
    } catch (err) {
      console.error('Redo failed:', err)
    }
  }, [refreshAll])

  // -----------------------------------------------------------------------
  // Keyboard: Escape, Undo, Redo (D-04, D-22)
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingNodeId(null)
        return
      }

      // Cmd/Ctrl+Z for undo, Cmd/Ctrl+Shift+Z for redo (D-22)
      // When ProseMirror has focus (user is editing text), let ProseMirror
      // handle undo/redo for uncommitted text changes. When no editor is
      // focused, use world-level undo/redo for committed changes.
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'z') {
        // Check if a ProseMirror editor has focus — if so, let it handle the key
        const active = document.activeElement
        const isEditorFocused = active && active.closest('.ProseMirror')
        if (isEditorFocused) return

        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleUndo, handleRedo])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="tapestry-app">
      {/* Top-left: file name + save indicator (D-02, D-05) */}
      <SaveIndicator filePath={filePath} saveState={saveState} />

      {/* Plugin error notification (D-34) */}
      {pluginError && (
        <PluginErrorNotification
          pluginName={pluginError.pluginName}
          message={pluginError.message}
          canRestart={pluginError.canRestart}
          onRestart={handlePluginRestart}
          onDismiss={handlePluginErrorDismiss}
        />
      )}

      {/* Canvas with pan/zoom, notes, connections, and controls */}
      <Canvas
        nodes={nodes}
        edges={edges}
        editingNodeId={editingNodeId}
        isFileLoaded={isFileLoaded}
        pluginNodeViews={pluginNodeViews}
        onStartEditing={(nodeId) => setEditingNodeId(nodeId)}
        onStopEditing={() => setEditingNodeId(null)}
        onCanvasDoubleClick={handleCanvasDoubleClick}
        onSave={handleNoteSave}
        onMarkDirty={handleMarkDirty}
        onMarkClean={handleMarkClean}
        onPositionChange={handlePositionChange}
        onWidthChange={handleWidthChange}
        onEdgeCreate={handleEdgeCreate}
        onDeleteNote={handleDeleteNote}
        onPropertyEdit={handlePropertyEdit}
      />
    </div>
  )
}
