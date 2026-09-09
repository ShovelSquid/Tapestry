/**
 * Main Tapestry application — renders a full-window 2D canvas (D-05)
 * with notes positioned at their world-space coordinates.
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
import NoteCard from './components/NoteCard'
import SaveIndicator from './components/SaveIndicator'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NodeInfo {
  id: string
  type: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

type SaveState = 'saved' | 'saving' | 'error'

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App(): React.ReactElement {
  const [nodes, setNodes] = useState<NodeInfo[]>([])
  const [filePath, setFilePath] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [isFileLoaded, setIsFileLoaded] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)

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
      // Kernel not loaded yet — show empty canvas
      setNodes([])
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

  useEffect(() => {
    // Check if a file is already loaded (e.g. from last-opened)
    refreshFilePath().then(() => refreshNodes())

    // Listen for file-opened events from the main process
    window.tapestry.onFileOpened((path: string) => {
      setFilePath(path)
      setIsFileLoaded(true)
      refreshNodes()
    })
  }, [refreshNodes, refreshFilePath])

  // -----------------------------------------------------------------------
  // Create note on double-click (D-04)
  // -----------------------------------------------------------------------

  const handleCanvasDoubleClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      // Only handle clicks on the canvas background, not on existing notes
      if (e.target !== canvasRef.current) return

      const x = e.clientX
      const y = e.clientY

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

      // Create a new note node at the click position
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
                'position.x': { type: 'real', value: x },
                'position.y': { type: 'real', value: y },
                body: { type: 'text', value: '' },
                title: { type: 'text', value: '' },
              },
            },
          ],
        )

        recomputeSaveState()

        // Refresh nodes and start editing the new one
        const updatedNodes = await window.tapestry.kernel.getNodes()
        setNodes(updatedNodes || [])

        // The new node ID is in the commit result
        if (commitResult.nodeIds && commitResult.nodeIds.length > 0) {
          setEditingNodeId(commitResult.nodeIds[0])
        }
      } catch (err) {
        console.error('Failed to create note:', err)
        setSaveState('error')
      }
    },
    [isFileLoaded, recomputeSaveState],
  )

  // -----------------------------------------------------------------------
  // Debounce tracking: mark/unmark notes as dirty
  // -----------------------------------------------------------------------

  /**
   * Called by NoteCard when a debounce timer starts (text changed).
   * Marks the note as dirty so the indicator shows "Saving...".
   */
  const handleMarkDirty = useCallback(
    (nodeId: string) => {
      dirtyNotesRef.current.add(nodeId)
      recomputeSaveState()
    },
    [recomputeSaveState],
  )

  /**
   * Called by NoteCard when its debounce timer fires (about to call onSave).
   * Removes the dirty mark — the IPC call is now tracked by pendingSavesRef.
   */
  const handleMarkClean = useCallback(
    (nodeId: string) => {
      dirtyNotesRef.current.delete(nodeId)
      // Don't recompute here — the onSave call will increment pendingSavesRef
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
  // Click outside note to end editing (D-04)
  // -----------------------------------------------------------------------

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === canvasRef.current) {
        setEditingNodeId(null)
      }
    },
    [],
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

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="tapestry-canvas"
        onDoubleClick={handleCanvasDoubleClick}
        onClick={handleCanvasClick}
      >
        {/* Empty state (UI-SPEC copywriting) */}
        {!isFileLoaded && nodes.length === 0 && (
          <div className="tapestry-empty-state">
            <h2 className="tapestry-empty-heading">
              Double-click anywhere to start
            </h2>
            <p className="tapestry-empty-body">
              Create notes, connect ideas, and build your world of thought.
            </p>
          </div>
        )}

        {/* Note cards */}
        {nodes.map((node) => (
          <NoteCard
            key={node.id}
            node={node}
            isEditing={editingNodeId === node.id}
            onStartEditing={() => setEditingNodeId(node.id)}
            onSave={handleNoteSave}
            onMarkDirty={handleMarkDirty}
            onMarkClean={handleMarkClean}
          />
        ))}
      </div>
    </div>
  )
}
