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
import { Schema } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, setBlockType } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { Command } from 'prosemirror-state'
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
  onHeightChange?: (nodeId: string, height: number) => void
  onDeleteNote: () => void
  onHover: (hovered: boolean) => void
  onHoverDuringConnection: () => void
  onLeaveDuringConnection: () => void
  onStartConnection: () => void
  onRegisterDims: (id: string, width: number, height: number) => void
  onDragMove?: (nodeId: string, x: number, y: number) => void
  onDragEnd?: (nodeId: string) => void
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

// extractTextAndTitle removed — replaced by serializeDoc for rich text (D-23)

// ---------------------------------------------------------------------------
// Heading toggle command (D-23): toggle between heading level and paragraph
// ---------------------------------------------------------------------------

function toggleHeading(level: number): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    const node = $from.parent
    // If already this heading level, convert back to paragraph
    if (node.type === noteSchema.nodes.heading && node.attrs.level === level) {
      return setBlockType(noteSchema.nodes.paragraph)(state, dispatch)
    }
    return setBlockType(noteSchema.nodes.heading, { level })(state, dispatch)
  }
}

// ---------------------------------------------------------------------------
// Rich text serialization helpers (D-23)
// ---------------------------------------------------------------------------

/**
 * Build a ProseMirror doc from plain text, one paragraph per line. The text
 * is inserted as text nodes through the schema — never parsed as HTML — so
 * a hand-edited .tree file or a plugin-written body cannot inject markup or
 * script into the renderer.
 */
function plainTextToDoc(body: string) {
  const paragraphs = body.split('\n').map((line) =>
    line
      ? noteSchema.node('paragraph', null, [noteSchema.text(line)])
      : noteSchema.node('paragraph'),
  )
  return noteSchema.node('doc', null, paragraphs)
}

/**
 * Try to parse body as ProseMirror JSON. If it fails (plain text from before
 * rich text was added), create a doc with paragraphs of text nodes.
 */
function deserializeBody(body: string): any {
  if (!body) return null
  try {
    const parsed = JSON.parse(body)
    // Validate it looks like a ProseMirror doc
    if (parsed && parsed.type === 'doc') {
      return noteSchema.nodeFromJSON(parsed)
    }
  } catch {
    // Not JSON — treat as plain text
  }
  // Plain text fallback: split on newlines and create paragraphs
  return plainTextToDoc(body)
}

function serializeBody(view: EditorView): string {
  return JSON.stringify(view.state.doc.toJSON())
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
}: NoteCardProps): React.ReactElement {
  const editorRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const x = Number(getNodeProp(node, 'position.x', 100))
  const y = Number(getNodeProp(node, 'position.y', 100))
  const body = String(getNodeProp(node, 'body', ''))
  const title = String(getNodeProp(node, 'title', ''))

  // The last body this editor itself emitted through onSave. When the `body`
  // prop catches up to it, that is an echo of our own save — not an external
  // change — and the editor must not be reset (it would drop un-debounced
  // keystrokes, the selection, and the ProseMirror undo history).
  const lastEmittedBodyRef = useRef<string>(body)
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

  // Stable refs for callbacks used inside ProseMirror dispatchTransaction
  const onSaveRef = useRef(onSave)
  const onMarkDirtyRef = useRef(onMarkDirty)
  const onMarkCleanRef = useRef(onMarkClean)
  onSaveRef.current = onSave
  onMarkDirtyRef.current = onMarkDirty
  onMarkCleanRef.current = onMarkClean

  // Effective position: local drag/resize position takes priority
  const effectiveX = localPos ? localPos.x : x
  const effectiveY = localPos ? localPos.y : y
  const effectiveWidth = localWidth ?? (storedWidth > 0 ? storedWidth : undefined)
  const effectiveHeight = localHeight ?? (storedHeight > 0 ? storedHeight : undefined)

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
  // Initialize ProseMirror editor
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!editorRef.current) return

    // Deserialize body: try JSON (rich text) first, fall back to plain text
    const doc = deserializeBody(body) || noteSchema.node('doc', null, [
      noteSchema.node('paragraph'),
    ])

    const state = EditorState.create({
      doc,
      schema: noteSchema,
      plugins: [
        history(),
        // Formatting keybindings (D-23): bold, italic, headings
        keymap({
          'Mod-b': toggleMark(noteSchema.marks.strong),
          'Mod-i': toggleMark(noteSchema.marks.em),
          'Mod-1': toggleHeading(1),
          'Mod-2': toggleHeading(2),
          'Mod-3': toggleHeading(3),
        }),
        keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo }),
        keymap(baseKeymap),
      ],
    })

    const nodeId = node.id
    lastEmittedBodyRef.current = body

    const view = new EditorView(editorRef.current, {
      state,
      editable: () => isEditing,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)

        // Transactions tagged externalSync come from the body-sync effect
        // below (undo/redo, plugin edits): they are already saved and must
        // not be treated as user edits.
        if (tr.docChanged && !tr.getMeta('externalSync')) {
          onMarkDirtyRef.current(nodeId)

          if (debounceRef.current) {
            clearTimeout(debounceRef.current)
          }
          debounceRef.current = setTimeout(() => {
            debounceRef.current = null
            onMarkCleanRef.current(nodeId)
            const newBody = serializeBody(view)
            lastEmittedBodyRef.current = newBody
            onSaveRef.current(nodeId, newBody, localTitleRef.current)
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
          const finalBody = serializeBody(viewRef.current)
          if (finalBody !== body) {
            lastEmittedBodyRef.current = finalBody
            onSaveRef.current(nodeId, finalBody, localTitleRef.current)
          }
        }
      }
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  // Sync the editor when the kernel's body changes underneath it (undo/redo,
  // a plugin writing the property). Only act on genuinely external changes:
  // skip echoes of our own saves and never clobber an in-progress edit.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    // Echo of a body this editor emitted (App mirrors saves into `nodes`)
    if (body === lastEmittedBodyRef.current) return
    // The user is mid-edit; the pending debounce will save their version
    if (debounceRef.current) return

    const currentBody = JSON.stringify(view.state.doc.toJSON())
    if (currentBody === body) {
      lastEmittedBodyRef.current = body
      return
    }

    const newDoc = deserializeBody(body) || noteSchema.node('doc', null, [
      noteSchema.node('paragraph'),
    ])
    // Replace the document through a transaction so plugin state (history,
    // selection mapping) is preserved instead of recreating the EditorState.
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content)
    tr.setMeta('addToHistory', false)
    tr.setMeta('externalSync', true)
    view.dispatch(tr)
    lastEmittedBodyRef.current = body
  }, [body])

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
          onMarkDirtyRef.current(node.id)
          if (debounceRef.current) clearTimeout(debounceRef.current)
          debounceRef.current = setTimeout(() => {
            debounceRef.current = null
            onMarkCleanRef.current(node.id)
            const view = viewRef.current
            if (view) {
              const b = serializeBody(view)
              lastEmittedBodyRef.current = b
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
