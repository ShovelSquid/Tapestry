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

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshNodes(), refreshEdges()])
  }, [refreshNodes, refreshEdges])

  useEffect(() => {
    refreshFilePath().then(() => refreshAll())

    window.tapestry.onFileOpened((path: string) => {
      setFilePath(path)
      setIsFileLoaded(true)
      refreshAll()
    })
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
  // Keyboard: Escape ends editing (D-04)
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingNodeId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="tapestry-app">
      {/* Top-left: file name + save indicator (D-02, D-05) */}
      <SaveIndicator filePath={filePath} saveState={saveState} />

      {/* Canvas with pan/zoom, notes, connections, and controls */}
      <Canvas
        nodes={nodes}
        edges={edges}
        editingNodeId={editingNodeId}
        isFileLoaded={isFileLoaded}
        onStartEditing={(nodeId) => setEditingNodeId(nodeId)}
        onStopEditing={() => setEditingNodeId(null)}
        onCanvasDoubleClick={handleCanvasDoubleClick}
        onSave={handleNoteSave}
        onMarkDirty={handleMarkDirty}
        onMarkClean={handleMarkClean}
        onPositionChange={handlePositionChange}
        onEdgeCreate={handleEdgeCreate}
      />
    </div>
  )
}
