/**
 * NoteCard -- renders a note at its world-space position with a ProseMirror
 * editor for inline text editing.
 *
 * Per D-04: Enter inserts a newline (ProseMirror default). The card receives
 * focus immediately after creation. Clicking text moves the caret. The note
 * is keyboard-first with minimal chrome.
 *
 * Per D-01: Dragging the card header/border moves the note in world space.
 * The new position is persisted through kernel:submit.
 *
 * Per D-07: Hover reveals controls without moving the caret or losing
 * existing text selection. Hover state and text focus are distinct.
 *
 * Per D-08: Clicking the border selects the whole note (accent border +
 * elevated shadow). Dragging edges/corners resizes it.
 *
 * Text changes are debounced (300ms) before submitting through the kernel
 * bridge (D-02 autosave). The component communicates its debounce lifecycle
 * to the parent via onMarkDirty/onMarkClean so the save indicator never
 * shows "Saved" while a debounce timer is active.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Schema, DOMParser as ProseDOMParser } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import NoteControls from './NoteControls'

// ---------------------------------------------------------------------------
// Schema -- use prosemirror-schema-basic (doc, paragraph, text, marks)
// ---------------------------------------------------------------------------

const noteSchema = new Schema({
  nodes: basicSchema.spec.nodes,
  marks: basicSchema.spec.marks,
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NodeInfo {
  id: string
  type: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

interface NoteCardProps {
  node: NodeInfo
  isEditing: boolean
  isHovered: boolean
  isSelected: boolean
  isConnectTarget: boolean
  isConnecting: boolean
  zoom: number
  onStartEditing: () => void
  onBorderSelect: () => void
  onSave: (nodeId: string, body: string, title: string) => Promise<void>
  onMarkDirty: (nodeId: string) => void
  onMarkClean: (nodeId: string) => void
  onPositionChange: (nodeId: string, x: number, y: number) => void
  onWidthChange: (nodeId: string, width: number) => void
  onDeleteNote: () => void
  onHover: (hovered: boolean) => void
  onHoverDuringConnection: () => void
  onLeaveDuringConnection: () => void
  onStartConnection: () => void
  onRegisterDims: (id: string, width: number, height: number) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNodeProp(
  node: NodeInfo,
  key: string,
  fallback: string | number | boolean = '',
): string | number | boolean {
  const prop = node.props[key]
  return prop ? prop.value : fallback
}

function extractTextAndTitle(view: EditorView): { body: string; title: string } {
  const doc = view.state.doc
  const lines: string[] = []
  let title = ''

  doc.forEach((child, _offset, index) => {
    const text = child.textContent
    if (index === 0 && text.trim()) {
      title = text.trim()
    }
    lines.push(text)
  })

  return { body: lines.join('\n'), title }
}

// Minimum width for resize (D-08)
const MIN_WIDTH = 120

// ---------------------------------------------------------------------------
// NoteCard
// ---------------------------------------------------------------------------

export default function NoteCard({
  node,
  isEditing,
  isHovered,
  isSelected,
  isConnectTarget,
  isConnecting,
  zoom,
  onStartEditing,
  onBorderSelect,
  onSave,
  onMarkDirty,
  onMarkClean,
  onPositionChange,
  onWidthChange,
  onDeleteNote,
  onHover,
  onHoverDuringConnection,
  onLeaveDuringConnection,
  onStartConnection,
  onRegisterDims,
}: NoteCardProps): React.ReactElement {
  const editorRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const x = Number(getNodeProp(node, 'position.x', 100))
  const y = Number(getNodeProp(node, 'position.y', 100))
  const body = String(getNodeProp(node, 'body', ''))
  const title = String(getNodeProp(node, 'title', ''))
  const storedWidth = node.props['width']
    ? Number(node.props['width'].value)
    : 0

  // Local drag position for immediate feedback before kernel confirms
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(
    null,
  )
  const [localWidth, setLocalWidth] = useState<number | null>(null)
  const isDraggingRef = useRef(false)
  const isResizingRef = useRef(false)
  const resizeDirRef = useRef<string>('')
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 })
  const resizeStartRef = useRef({
    mouseX: 0,
    width: 0,
  })

  // Hover delay for controls (D-06: controls remain reachable)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showControls, setShowControls] = useState(false)

  // Stable refs for callbacks used inside ProseMirror dispatchTransaction
  const onSaveRef = useRef(onSave)
  const onMarkDirtyRef = useRef(onMarkDirty)
  const onMarkCleanRef = useRef(onMarkClean)
  onSaveRef.current = onSave
  onMarkDirtyRef.current = onMarkDirty
  onMarkCleanRef.current = onMarkClean

  // Effective position: local drag position takes priority
  const effectiveX = localPos ? localPos.x : x
  const effectiveY = localPos ? localPos.y : y
  const effectiveWidth = localWidth ?? (storedWidth > 0 ? storedWidth : undefined)

  // -----------------------------------------------------------------------
  // Register dimensions for connection line center computation
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      onRegisterDims(node.id, rect.width / zoom, rect.height / zoom)
    }
  })

  // -----------------------------------------------------------------------
  // Hover management (D-06, D-07)
  // -----------------------------------------------------------------------

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setShowControls(true)
    onHover(true)
    if (isConnecting) {
      onHoverDuringConnection()
    }
  }, [onHover, isConnecting, onHoverDuringConnection])

  const handleMouseLeave = useCallback(() => {
    // Delay hiding controls so the user can move from note to control (D-06)
    hoverTimeoutRef.current = setTimeout(() => {
      setShowControls(false)
      onHover(false)
    }, 300)
    if (isConnecting) {
      onLeaveDuringConnection()
    }
  }, [onHover, isConnecting, onLeaveDuringConnection])

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    }
  }, [])

  // Show controls when selected too
  useEffect(() => {
    if (isSelected || isHovered) {
      setShowControls(true)
    }
  }, [isSelected, isHovered])

  // -----------------------------------------------------------------------
  // Initialize ProseMirror editor
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!editorRef.current) return

    const element = document.createElement('div')
    if (body) {
      const lines = body.split('\n')
      element.innerHTML = lines
        .map((line) => `<p>${line || '<br>'}</p>`)
        .join('')
    } else {
      element.innerHTML = '<p><br></p>'
    }

    const doc = ProseDOMParser.fromSchema(noteSchema).parse(element)

    const state = EditorState.create({
      doc,
      schema: noteSchema,
      plugins: [
        history(),
        keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo }),
        keymap(baseKeymap),
      ],
    })

    const nodeId = node.id

    const view = new EditorView(editorRef.current, {
      state,
      editable: () => isEditing,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)

        if (tr.docChanged) {
          onMarkDirtyRef.current(nodeId)

          if (debounceRef.current) {
            clearTimeout(debounceRef.current)
          }
          debounceRef.current = setTimeout(() => {
            debounceRef.current = null
            onMarkCleanRef.current(nodeId)
            const { body: newBody, title: newTitle } = extractTextAndTitle(view)
            onSaveRef.current(nodeId, newBody, newTitle)
          }, 300)
        }
      },
    })

    viewRef.current = view

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
        onMarkCleanRef.current(nodeId)
        if (viewRef.current) {
          const { body: finalBody, title: finalTitle } = extractTextAndTitle(
            viewRef.current,
          )
          if (finalBody !== body || finalTitle !== title) {
            onSaveRef.current(nodeId, finalBody, finalTitle)
          }
        }
      }
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  // -----------------------------------------------------------------------
  // Update editability when isEditing changes
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.setProps({ editable: () => isEditing })
      if (isEditing) {
        viewRef.current.focus()
      }
    }
  }, [isEditing])

  // -----------------------------------------------------------------------
  // Drag to reposition (D-01)
  // -----------------------------------------------------------------------

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      // Only drag on primary button
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()

      isDraggingRef.current = true
      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        startX: effectiveX,
        startY: effectiveY,
      }

      const onMove = (me: PointerEvent) => {
        if (!isDraggingRef.current) return
        const dx = (me.clientX - dragStartRef.current.mouseX) / zoom
        const dy = (me.clientY - dragStartRef.current.mouseY) / zoom
        setLocalPos({
          x: dragStartRef.current.startX + dx,
          y: dragStartRef.current.startY + dy,
        })
      }

      const onUp = () => {
        isDraggingRef.current = false
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)

        // Persist position
        setLocalPos((pos) => {
          if (pos) {
            onPositionChange(node.id, pos.x, pos.y)
          }
          return null
        })
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [effectiveX, effectiveY, zoom, node.id, onPositionChange],
  )

  // -----------------------------------------------------------------------
  // Resize (D-08)
  // -----------------------------------------------------------------------

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, direction: string) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()

      isResizingRef.current = true
      resizeDirRef.current = direction
      const currentWidth =
        effectiveWidth ??
        (cardRef.current
          ? cardRef.current.getBoundingClientRect().width / zoom
          : 240)
      resizeStartRef.current = {
        mouseX: e.clientX,
        width: currentWidth,
      }

      const onMove = (me: PointerEvent) => {
        if (!isResizingRef.current) return
        const dx = (me.clientX - resizeStartRef.current.mouseX) / zoom
        let multiplier = 1
        if (
          resizeDirRef.current === 'left' ||
          resizeDirRef.current === 'top-left' ||
          resizeDirRef.current === 'bottom-left'
        ) {
          multiplier = -1
        }
        const newWidth = Math.max(
          MIN_WIDTH,
          resizeStartRef.current.width + dx * multiplier,
        )
        setLocalWidth(newWidth)
      }

      const onUp = () => {
        isResizingRef.current = false
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)

        setLocalWidth((w) => {
          if (w !== null) {
            onWidthChange(node.id, w)
          }
          return null
        })
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [effectiveWidth, zoom, node.id, onWidthChange],
  )

  // -----------------------------------------------------------------------
  // Click handlers
  // -----------------------------------------------------------------------

  const handleEditorClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!isEditing) {
        onStartEditing()
      }
    },
    [isEditing, onStartEditing],
  )

  const handleBorderClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onBorderSelect()
    },
    [onBorderSelect],
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const showControlsBool = showControls || isSelected
  const isHighlighted = isEditing || isSelected || isConnectTarget

  let borderClass = 'tapestry-note-card'
  if (isHighlighted) borderClass += ' tapestry-note-card--selected'
  if (isEditing) borderClass += ' tapestry-note-card--editing'
  if (isConnectTarget) borderClass += ' tapestry-note-card--connect-target'

  const cardStyle: React.CSSProperties = {
    left: `${effectiveX}px`,
    top: `${effectiveY}px`,
    ...(effectiveWidth ? { width: `${effectiveWidth}px`, minWidth: `${MIN_WIDTH}px`, maxWidth: 'none' } : {}),
  }

  return (
    <div
      ref={cardRef}
      className={borderClass}
      style={cardStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerUp={(e) => {
        // When in connecting mode and pointer released on this note
        e.stopPropagation()
      }}
    >
      {/* Drag handle area -- the top border strip */}
      <div
        className="tapestry-note-drag-handle"
        onPointerDown={handleDragStart}
        onClick={handleBorderClick}
      />

      {/* Title (read-only display derived from body) */}
      {title && <div className="tapestry-note-title">{title}</div>}

      {/* ProseMirror editor */}
      <div
        className="tapestry-note-editor"
        ref={editorRef}
        onClick={handleEditorClick}
      />

      {/* Bubbly controls (D-06) */}
      {showControlsBool && (
        <NoteControls
          onConnect={onStartConnection}
          onDelete={onDeleteNote}
        />
      )}

      {/* Resize handles (D-08) -- only when selected */}
      {isSelected && (
        <>
          <div
            className="tapestry-resize-handle tapestry-resize-handle--right"
            onPointerDown={(e) => handleResizeStart(e, 'right')}
          />
          <div
            className="tapestry-resize-handle tapestry-resize-handle--left"
            onPointerDown={(e) => handleResizeStart(e, 'left')}
          />
          <div
            className="tapestry-resize-handle tapestry-resize-handle--corner-tr"
            onPointerDown={(e) => handleResizeStart(e, 'right')}
          />
          <div
            className="tapestry-resize-handle tapestry-resize-handle--corner-tl"
            onPointerDown={(e) => handleResizeStart(e, 'left')}
          />
          <div
            className="tapestry-resize-handle tapestry-resize-handle--corner-br"
            onPointerDown={(e) => handleResizeStart(e, 'right')}
          />
          <div
            className="tapestry-resize-handle tapestry-resize-handle--corner-bl"
            onPointerDown={(e) => handleResizeStart(e, 'left')}
          />
        </>
      )}
    </div>
  )
}
