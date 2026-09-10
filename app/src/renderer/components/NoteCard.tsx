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
 *
 * Refactored for Phase 2.1: uses the shared useProseMirror hook from
 * editor/use-prosemirror.ts (D-26 universal editing).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useProseMirror } from '../editor/use-prosemirror'
import NoteControls from './NoteControls'

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
  onHeightChange?: (nodeId: string, height: number) => void
  onDeleteNote: () => void
  onHover: (hovered: boolean) => void
  onHoverDuringConnection: () => void
  onLeaveDuringConnection: () => void
  onStartConnection: () => void
  onRegisterDims: (id: string, width: number, height: number) => void
  onDragMove?: (nodeId: string, x: number, y: number) => void
  onDragEnd?: (nodeId: string) => void
  /** Reports ProseMirror selection state upward for passage connection flow */
  onSelectionChange?: (nodeId: string, hasSelection: boolean, from: number, to: number) => void
  /** Whether another note has a text selection (for NoteControls tooltip) */
  hasTextSelection?: boolean
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

const MIN_WIDTH = 120
const MIN_HEIGHT = 60

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
  onHeightChange,
  onDeleteNote,
  onHover,
  onHoverDuringConnection,
  onLeaveDuringConnection,
  onStartConnection,
  onRegisterDims,
  onDragMove,
  onDragEnd,
  onSelectionChange,
  hasTextSelection,
}: NoteCardProps): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null)

  const x = Number(getNodeProp(node, 'position.x', 100))
  const y = Number(getNodeProp(node, 'position.y', 100))
  const body = String(getNodeProp(node, 'body', ''))
  const title = String(getNodeProp(node, 'title', ''))

  const storedWidth = node.props['width']
    ? Number(node.props['width'].value)
    : 0
  const storedHeight = node.props['height']
    ? Number(node.props['height'].value)
    : 0

  // Local title state (separate from body, editable inline)
  const [localTitle, setLocalTitle] = useState(title)
  const localTitleRef = useRef(title)
  localTitleRef.current = localTitle

  // Track whether the title debounce is in-flight so the save callback
  // can include the correct title value
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ref for onSave callback used by the title debounce and the hook's save
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  // ----- Shared ProseMirror hook (D-26) -----
  const handleEditorSave = useCallback(
    (nodeId: string, newBody: string) => {
      onSaveRef.current(nodeId, newBody, localTitleRef.current)
    },
    [],
  )

  const { editorRef, viewRef, getSelection, applyPassageMark, forceSave } = useProseMirror({
    nodeId: node.id,
    initialBody: body,
    isEditing,
    onSave: handleEditorSave,
    onMarkDirty,
    onMarkClean,
  })

  // Local drag position for immediate feedback before kernel confirms
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(
    null,
  )
  const [localWidth, setLocalWidth] = useState<number | null>(null)
  const [localHeight, setLocalHeight] = useState<number | null>(null)
  const isDraggingRef = useRef(false)
  const isResizingRef = useRef(false)
  const resizeDirRef = useRef<string>('')
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 })
  const resizeStartRef = useRef({
    mouseX: 0,
    mouseY: 0,
    width: 0,
    height: 0,
    posX: 0,
    posY: 0,
  })

  // Hover delay for controls (D-06: controls remain reachable)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showControls, setShowControls] = useState(false)

  // Effective position: local drag/resize position takes priority
  const effectiveX = localPos ? localPos.x : x
  const effectiveY = localPos ? localPos.y : y
  const effectiveWidth = localWidth ?? (storedWidth > 0 ? storedWidth : undefined)
  const effectiveHeight = localHeight ?? (storedHeight > 0 ? storedHeight : undefined)

  // -----------------------------------------------------------------------
  // Report ProseMirror selection state upward for passage connection flow
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!onSelectionChange) return
    const view = viewRef.current
    if (!view) return

    // Poll selection on every transaction by watching the editor
    const checkSelection = () => {
      const sel = getSelection()
      if (sel) {
        onSelectionChange(node.id, sel.hasSelection, sel.from, sel.to)
      }
    }

    // Use a MutationObserver on the editor element to detect selection changes
    // ProseMirror updates the DOM after transactions, so we also listen for
    // document selection changes
    const handleSelectionChange = () => {
      const active = document.activeElement
      if (active && editorRef.current?.contains(active)) {
        checkSelection()
      } else {
        // Editor lost focus -- report no selection
        onSelectionChange(node.id, false, 0, 0)
      }
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [node.id, onSelectionChange, getSelection, viewRef, editorRef])

  // -----------------------------------------------------------------------
  // Register dimensions for connection line center computation
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      onRegisterDims(node.id, rect.width / zoom, rect.height / zoom)
    }
  })

  // Clear local overrides once kernel props converge (prevents flicker)
  useEffect(() => {
    if (!isDraggingRef.current && !isResizingRef.current) {
      if (localPos) setLocalPos(null)
      if (localWidth !== null) setLocalWidth(null)
      if (localHeight !== null) setLocalHeight(null)
    }
  }, [x, y, storedWidth, storedHeight])

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

  // Sync localTitle when the title prop changes externally (undo/redo)
  useEffect(() => {
    setLocalTitle(title)
  }, [title])

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
        const newX = dragStartRef.current.startX + dx
        const newY = dragStartRef.current.startY + dy
        setLocalPos({ x: newX, y: newY })
        onDragMove?.(node.id, newX, newY)
      }

      const onUp = () => {
        isDraggingRef.current = false
        document.removeEventListener('pointermove', onMove, true)
        document.removeEventListener('pointerup', onUp, true)
        onDragEnd?.(node.id)

        setLocalPos((pos) => {
          if (pos) onPositionChange(node.id, pos.x, pos.y)
          return pos
        })
      }

      document.addEventListener('pointermove', onMove, true)
      document.addEventListener('pointerup', onUp, true)
    },
    [effectiveX, effectiveY, zoom, node.id, onPositionChange, onDragMove, onDragEnd],
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
      const currentHeight =
        effectiveHeight ??
        (cardRef.current
          ? cardRef.current.getBoundingClientRect().height / zoom
          : 100)
      resizeStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        width: currentWidth,
        height: currentHeight,
        posX: effectiveX,
        posY: effectiveY,
      }

      const onMove = (me: PointerEvent) => {
        if (!isResizingRef.current) return
        const dx = (me.clientX - resizeStartRef.current.mouseX) / zoom
        const dy = (me.clientY - resizeStartRef.current.mouseY) / zoom
        const dir = resizeDirRef.current

        let newWidth = resizeStartRef.current.width
        let newHeight = resizeStartRef.current.height
        let newX = resizeStartRef.current.posX
        let newY = resizeStartRef.current.posY

        if (dir.includes('right')) {
          newWidth = Math.max(MIN_WIDTH, resizeStartRef.current.width + dx)
        }
        if (dir.includes('left')) {
          const raw = resizeStartRef.current.width - dx
          newWidth = Math.max(MIN_WIDTH, raw)
          newX = resizeStartRef.current.posX + (resizeStartRef.current.width - newWidth)
        }
        if (dir.includes('bottom')) {
          newHeight = Math.max(MIN_HEIGHT, resizeStartRef.current.height + dy)
        }
        if (dir.includes('top')) {
          const raw = resizeStartRef.current.height - dy
          newHeight = Math.max(MIN_HEIGHT, raw)
          newY = resizeStartRef.current.posY + (resizeStartRef.current.height - newHeight)
        }

        setLocalWidth(newWidth)
        setLocalHeight(newHeight)
        if (newX !== resizeStartRef.current.posX || newY !== resizeStartRef.current.posY) {
          setLocalPos({ x: newX, y: newY })
        }
      }

      const onUp = () => {
        isResizingRef.current = false
        document.removeEventListener('pointermove', onMove, true)
        document.removeEventListener('pointerup', onUp, true)

        setLocalWidth((w) => {
          if (w !== null) onWidthChange(node.id, w)
          return w
        })
        setLocalHeight((h) => {
          if (h !== null) onHeightChange?.(node.id, h)
          return h
        })
        setLocalPos((pos) => {
          if (pos) onPositionChange(node.id, pos.x, pos.y)
          return pos
        })
      }

      document.addEventListener('pointermove', onMove, true)
      document.addEventListener('pointerup', onUp, true)
    },
    [effectiveWidth, effectiveHeight, effectiveX, effectiveY, zoom, node.id, onWidthChange, onHeightChange, onPositionChange],
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
    ...(effectiveHeight ? { height: `${effectiveHeight}px`, minHeight: `${MIN_HEIGHT}px` } : {}),
  }

  return (
    <div
      ref={cardRef}
      className={borderClass}
      style={cardStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Drag handle area -- the top border strip */}
      <div
        className="tapestry-note-drag-handle"
        onPointerDown={handleDragStart}
        onClick={handleBorderClick}
      />

      {/* Editable title */}
      <input
        type="text"
        className="tapestry-note-title-input"
        value={localTitle}
        placeholder="Untitled"
        readOnly={!isEditing}
        onChange={(e) => {
          const newTitle = e.target.value
          setLocalTitle(newTitle)
          onMarkDirty(node.id)
          if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current)
          titleDebounceRef.current = setTimeout(() => {
            titleDebounceRef.current = null
            onMarkClean(node.id)
            const view = viewRef.current
            if (view) {
              const b = JSON.stringify(view.state.doc.toJSON())
              onSaveRef.current(node.id, b, newTitle)
            }
          }, 300)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            viewRef.current?.focus()
          }
        }}
        onClick={(e) => {
          e.stopPropagation()
          if (!isEditing) onStartEditing()
        }}
      />

      {/* ProseMirror body editor */}
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
          hasTextSelection={hasTextSelection}
        />
      )}

      {/* Resize handles (D-08) -- visible on hover or selection */}
      {showControlsBool && (
        <>
          <div className="tapestry-resize-handle tapestry-resize-handle--right"
            onPointerDown={(e) => handleResizeStart(e, 'right')} />
          <div className="tapestry-resize-handle tapestry-resize-handle--left"
            onPointerDown={(e) => handleResizeStart(e, 'left')} />
          <div className="tapestry-resize-handle tapestry-resize-handle--top"
            onPointerDown={(e) => handleResizeStart(e, 'top')} />
          <div className="tapestry-resize-handle tapestry-resize-handle--bottom"
            onPointerDown={(e) => handleResizeStart(e, 'bottom')} />
          <div className="tapestry-resize-handle tapestry-resize-handle--corner-tr"
            onPointerDown={(e) => handleResizeStart(e, 'top-right')} />
          <div className="tapestry-resize-handle tapestry-resize-handle--corner-tl"
            onPointerDown={(e) => handleResizeStart(e, 'top-left')} />
          <div className="tapestry-resize-handle tapestry-resize-handle--corner-br"
            onPointerDown={(e) => handleResizeStart(e, 'bottom-right')} />
          <div className="tapestry-resize-handle tapestry-resize-handle--corner-bl"
            onPointerDown={(e) => handleResizeStart(e, 'bottom-left')} />
        </>
      )}
    </div>
  )
}
