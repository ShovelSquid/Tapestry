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

import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import { useProseMirror } from '../editor/use-prosemirror'
import { layoutSize, screenDeltaToWorld, screenToElementLocal } from '../layout/camera'
import { inkShape, nearestT, seedFromId } from '../look/ink'
import { InkLine } from '../look/InkLine'
import { NoteInk, noteShape } from '../look/NoteInk'
import { CornerCluster } from '../look/CornerCluster'
import { FormatBar } from '../look/FormatBar'
import { NoteSettings } from '../look/NoteSettings'
import { MoveParticles } from '../look/MoveParticles'
import { registerRifle } from '../look/rifle'
import { DARK, aimLight, type LightTween } from '../look/bloom'
import { bobScale, effectStrength, frameScheduler, readMotionSettings } from '../look/motion'
import { LOOK } from '../look/values'
import ProvenanceBadge, { actorSpokenText } from './ProvenanceBadge'
import { AskClaudeButton, useContextMenu } from './ContextMenu'
import { ChatContext } from '../state/chat'

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
  /** The tree this note is in, for Ask Claude… (D-19). */
  treeId?: string
  /**
   * Where a following note is drawn, beside its grew-from parent (D-05). Set
   * only for a following note; every other note keeps its stored position.
   */
  displayPosition?: { x: number; y: number }
  isEditing: boolean
  isHovered: boolean
  isSelected: boolean
  isConnectTarget: boolean
  isConnecting: boolean
  zoom: number
  /**
   * The drawn camera roll, in degrees. With zoom, it turns screen deltas into
   * world deltas, so a drag stays under the pointer on a rolled canvas.
   * Defaults to 0 (unrolled).
   */
  roll?: number
  /**
   * Who made this note and who changed it last, derived by the kernel from
   * the commits in the journal (D-05). Undefined until history is read.
   */
  provenance?: TapestryNodeHistory
  /**
   * The actor id this person's own changes are signed with (D-07). Carried
   * for the D-05 authorship checks Plan 04 adds; the footer below shows the
   * literal actor id either way, so it is not read here yet.
   */
  currentUserActorId?: string | null
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
  /**
   * The smallest size this note is drawn at, when notes sit inside it: large
   * enough to hold them (layout/nesting.ts). Its stored size is not changed.
   */
  minSize?: { width: number; height: number }
  /** "New note inside": make a note on this note's surface. */
  onCreateInside?: () => void
  /** "Zoom into note": fit this note to the view. */
  onZoomTo?: () => void
  /** The zoom-collapse crossfade (look/collapse.ts): fading in, or out to a circle or dot. */
  formFade?: 'in' | 'out' | null
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

/** The card's side padding (App.css), which the ink rule spans inside. */
const CARD_PAD = 16

/** The hover bloom's length right now: 0 when the effect is off. */
function bloomMs(): number {
  return effectStrength(readMotionSettings(), 'hoverBloom') > 0 ? LOOK.motion.hoverBloomMs : 0
}

// ---------------------------------------------------------------------------
// NoteCard
// ---------------------------------------------------------------------------

export default function NoteCard({
  node,
  treeId,
  displayPosition,
  isEditing,
  isHovered,
  isSelected,
  isConnectTarget,
  isConnecting,
  zoom,
  roll = 0,
  provenance,
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
  minSize,
  onCreateInside,
  onZoomTo,
  formFade,
}: NoteCardProps): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null)

  const x = displayPosition ? displayPosition.x : Number(getNodeProp(node, 'position.x', 100))
  const y = displayPosition ? displayPosition.y : Number(getNodeProp(node, 'position.y', 100))
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
  const onMarkCleanRef = useRef(onMarkClean)
  onMarkCleanRef.current = onMarkClean

  // Latest body prop, used as a fallback when flushing a title save after
  // the editor view has already been destroyed.
  const bodyRef = useRef(body)
  bodyRef.current = body

  // ----- Shared ProseMirror hook (D-26) -----
  const handleEditorSave = useCallback(
    (nodeId: string, newBody: string) => {
      onSaveRef.current(nodeId, newBody, localTitleRef.current)
    },
    [],
  )

  // applyPassageMark / forceSave are not destructured: the passage-connection
  // flow that would call them is not wired yet (see CR-03 in the review).
  const { editorRef, viewRef, getSelection } = useProseMirror({
    nodeId: node.id,
    initialBody: body,
    isEditing,
    onSave: handleEditorSave,
    onMarkDirty,
    onMarkClean,
  })

  // The EditorView is created inside the hook's effect, so expose it as state
  // for the format bar (D-24). This effect is declared after the hook, so
  // it runs after the view exists (and again if node.id recreates it).
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  useEffect(() => {
    setEditorView(viewRef.current)
  }, [node.id, viewRef])

  // Remember the most recent view. The hook nulls viewRef in its own cleanup,
  // but a destroyed EditorView still exposes its final state.doc, which lets
  // the title flush below serialize the real body regardless of cleanup order.
  const lastViewRef = useRef<EditorView | null>(null)
  if (viewRef.current) lastViewRef.current = viewRef.current

  // D-02 autosave: a title edit is debounced 300ms. If the card unmounts (or
  // switches node) inside that window the timer used to fire against a dead
  // view: it called onMarkClean ("Saved") and then skipped onSave, silently
  // losing the title. Flush the pending title save on cleanup instead.
  useEffect(() => {
    const nodeId = node.id
    return () => {
      if (!titleDebounceRef.current) return
      clearTimeout(titleDebounceRef.current)
      titleDebounceRef.current = null
      onMarkCleanRef.current(nodeId)
      const view = viewRef.current ?? lastViewRef.current
      const b = view ? JSON.stringify(view.state.doc.toJSON()) : bodyRef.current
      onSaveRef.current(nodeId, b, localTitleRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  // Local drag position for immediate feedback before kernel confirms
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(
    null,
  )
  const [localWidth, setLocalWidth] = useState<number | null>(null)
  const [localHeight, setLocalHeight] = useState<number | null>(null)
  const isDraggingRef = useRef(false)
  // The same as the ref, as state, so the move particles run only while dragged.
  const [dragging, setDragging] = useState(false)
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

  // ----- The note look (Line Lab v2 wave 2) -----
  //
  // The card's layout size in its own px (offset sizes ignore the zoom and
  // the bob), so the outline is built once per size and seed, never per zoom.
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const measure = (): void => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const seed = useMemo(() => seedFromId(node.id), [node.id])
  const outline = useMemo(() => (box.w > 0 && box.h > 0 ? noteShape(box.w, box.h, seed) : null), [box.w, box.h, seed])
  const ruleLen = Math.max(0, box.w - 2 * CARD_PAD - 24)
  const rule = useMemo(
    () => (ruleLen > 0 ? inkShape([{ x: 0, y: 3 }, { x: ruleLen, y: 2 }], false, seed + 2, { step: 2, wobbleScale: 0.6 }) : null),
    [ruleLen, seed],
  )

  // The last pointer point in the card's px: where the bloom comes in and
  // leaves, and where the blue starts.
  const lastPtRef = useRef({ x: 0, y: 0 })
  const localPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const el = cardRef.current
    if (!el) return lastPtRef.current
    const p = screenToElementLocal(
      { x: e.clientX, y: e.clientY },
      el.getBoundingClientRect(),
      { width: el.offsetWidth, height: el.offsetHeight },
      zoom,
      roll,
    )
    lastPtRef.current = p
    return p
  }

  // The blue replaces the pencil while the note is selected, edited, or the
  // target of a connection; it grows from the last pointer point.
  const blue = isSelected || isEditing || isConnectTarget
  const blueFromTRef = useRef(0)
  const wasBlueRef = useRef(blue)
  if (blue && !wasBlueRef.current && outline) {
    blueFromTRef.current = nearestT(outline, lastPtRef.current.x, lastPtRef.current.y)
  }
  wasBlueRef.current = blue

  const [light, setLight] = useState<LightTween>(DARK)
  const pointerInRef = useRef(false)
  // A note that turns blue without the pointer on it lights from the last
  // point; one that loses its blue with the pointer away drains toward it.
  useEffect(() => {
    if (pointerInRef.current) return
    const { x: px, y: py } = lastPtRef.current
    setLight((l) => aimLight(l, px, py, blue ? 1 : 0, performance.now(), bloomMs()))
  }, [blue])

  // The bob plays when the note turns blue. It is a transform on the card,
  // so the dims reported for connections divide it back out.
  const bobRef = useRef(1)
  useEffect(() => {
    if (!blue) return
    const strength = effectStrength(readMotionSettings(), 'bob')
    const el = cardRef.current
    if (!el || strength <= 0) return
    const start = performance.now()
    const unsubscribe = frameScheduler().subscribe((nowMs) => {
      const elapsed = nowMs - start
      const s = bobScale(LOOK.motion.bobKeyframes, LOOK.motion.bobMs, elapsed, strength)
      bobRef.current = s
      el.style.transform = s === 1 ? '' : `scale(${s})`
      if (elapsed >= LOOK.motion.bobMs) unsubscribe()
    })
    return () => {
      unsubscribe()
      bobRef.current = 1
      el.style.transform = ''
    }
  }, [blue])

  // Rifling and text bob (Line Lab v2 wave 6): the card drifts from a
  // passing cursor and its text shifts a hair. Never while it's in hand or
  // being written in.
  const rifleState = useRef({ zoom, roll, editing: isEditing })
  rifleState.current = { zoom, roll, editing: isEditing }
  useEffect(() => {
    const el = cardRef.current
    if (!el) return undefined
    return registerRifle({
      el,
      text: () => editorRef.current,
      toLocal: (dx, dy) => screenDeltaToWorld(dx, dy, rifleState.current.zoom, rifleState.current.roll),
      enabled: () => !isDraggingRef.current && !isResizingRef.current && !rifleState.current.editing,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The format bar and the settings face (Line Lab v2 wave 3). The red dot's
  // hover folds the format pill; settings close when the note loses its blue.
  const [redHover, setRedHover] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const toggleSettings = useCallback(() => setSettingsOpen((o) => !o), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const [faceShown, setFaceShown] = useState(false)
  useEffect(() => {
    if (!blue) setSettingsOpen(false)
  }, [blue])

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
      const size = layoutSize(cardRef.current, zoom, roll)
      const bob = roll === 0 ? bobRef.current : 1
      onRegisterDims(node.id, size.width / bob, size.height / bob)
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

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    pointerInRef.current = true
    const p = localPoint(e)
    setLight((l) => aimLight(l, p.x, p.y, 1, performance.now(), bloomMs()))
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setShowControls(true)
    onHover(true)
    if (isConnecting) {
      onHoverDuringConnection()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHover, isConnecting, onHoverDuringConnection, zoom, roll])

  const handleMouseLeave = useCallback((e: React.MouseEvent) => {
    pointerInRef.current = false
    const p = localPoint(e)
    // A blue note keeps its light; the exit runs when it isn't (Line Lab task 4).
    if (!blue) setLight((l) => aimLight(l, p.x, p.y, 0, performance.now(), bloomMs()))
    // Delay hiding controls so the user can move from note to control (D-06)
    hoverTimeoutRef.current = setTimeout(() => {
      setShowControls(false)
      onHover(false)
    }, 300)
    if (isConnecting) {
      onLeaveDuringConnection()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHover, isConnecting, onLeaveDuringConnection, blue, zoom, roll])

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
      setDragging(true)
      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        startX: effectiveX,
        startY: effectiveY,
      }

      const onMove = (me: PointerEvent) => {
        if (!isDraggingRef.current) return
        const d = screenDeltaToWorld(
          me.clientX - dragStartRef.current.mouseX,
          me.clientY - dragStartRef.current.mouseY,
          zoom,
          roll,
        )
        const newX = dragStartRef.current.startX + d.x
        const newY = dragStartRef.current.startY + d.y
        setLocalPos({ x: newX, y: newY })
        onDragMove?.(node.id, newX, newY)
      }

      const onUp = () => {
        isDraggingRef.current = false
        setDragging(false)
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
    [effectiveX, effectiveY, zoom, roll, node.id, onPositionChange, onDragMove, onDragEnd],
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
      const measured = cardRef.current ? layoutSize(cardRef.current, zoom, roll) : null
      const currentWidth = effectiveWidth ?? (measured ? measured.width : 240)
      const currentHeight = effectiveHeight ?? (measured ? measured.height : 100)
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
        // In the card's own axes, so the left and top rules hold at any roll.
        const { x: dx, y: dy } = screenDeltaToWorld(
          me.clientX - resizeStartRef.current.mouseX,
          me.clientY - resizeStartRef.current.mouseY,
          zoom,
          roll,
        )
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
    [effectiveWidth, effectiveHeight, effectiveX, effectiveY, zoom, roll, node.id, onWidthChange, onHeightChange, onPositionChange],
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

  // ----- Provenance footer (D-06, D-07, DRAW-04) -----
  //
  // Visibility follows the UI-SPEC: a note something other than a person
  // touched says so permanently, because that is the fact a reader would
  // otherwise have to go looking for. A note you wrote and last changed
  // yourself keeps the card quiet and shows its footer on hover, selection,
  // editing or keyboard focus.
  let provenanceFooter: React.ReactElement | null = null
  if (provenance) {
    const { createdBy, changedBy } = provenance
    const wasChangedByOther = changedBy.kind !== createdBy.kind || changedBy.id !== createdBy.id
    const machineAttributed =
      createdBy.id.startsWith('agent.') ||
      changedBy.id.startsWith('agent.') ||
      changedBy.id === 'obsidian.bridge'

    // The full ids, never truncated, for the tooltip and the screen reader.
    const tooltip =
      `Created by ${createdBy.id} in change ${provenance.createdSeq}. ` +
      `Last changed by ${changedBy.id} in change ${provenance.changedSeq}.`
    const spoken = wasChangedByOther
      ? `Created by ${actorSpokenText(createdBy)}, changed by ${actorSpokenText(changedBy)}`
      : `Created by ${actorSpokenText(createdBy)}`

    provenanceFooter = (
      <div
        className={
          'tapestry-provenance-footer' +
          (machineAttributed ? '' : ' tapestry-provenance-footer--hidden')
        }
        title={tooltip}
        role="group"
        aria-label={spoken}
      >
        {/* The visible row is hidden from screen readers: the footer's own
            accessible name above is the single, complete reading. */}
        <span aria-hidden="true">Created by</span>
        <ProvenanceBadge actor={createdBy} />
        {wasChangedByOther && (
          <>
            <span aria-hidden="true">· changed by</span>
            <ProvenanceBadge actor={changedBy} />
          </>
        )}
      </div>
    )
  }

  // ----- Ask Claude… about this note (D-19) -----
  //
  // Notes live in trees, not workspaces, so the chat opens for the workspace
  // under the pointer or the last one used, and Claude reads the note through
  // the tapestry tools it already has (read_note).
  const { openChat, treeName } = useContext(ChatContext)
  const openContextMenu = useContextMenu()
  const askClaude = useCallback(() => {
    if (!treeId) {
      openChat({})
      return
    }
    openChat({
      treeId,
      attachment: {
        kind: 'note',
        treeId,
        treeName: treeName(treeId),
        noteId: node.id,
        title: localTitle.trim().length > 0 ? localTitle : 'Untitled',
      },
    })
  }, [openChat, treeName, treeId, node.id, localTitle])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // While the note is being edited, its text keeps the native menu.
      const target = e.target as HTMLElement
      if (isEditing && (target.closest('.ProseMirror') || target.closest('input'))) return
      const items = [{ label: 'Ask Claude…', run: askClaude }]
      if (onCreateInside) items.push({ label: 'New note inside', run: onCreateInside })
      if (onZoomTo) items.push({ label: 'Zoom into note', run: onZoomTo })
      openContextMenu(e, items)
    },
    [isEditing, openContextMenu, askClaude, onCreateInside, onZoomTo],
  )

  const askLabel = `Ask Claude about ${localTitle.trim().length > 0 ? localTitle : 'Untitled'}`

  let borderClass = 'tapestry-note-card'
  if (isHighlighted) borderClass += ' tapestry-note-card--selected'
  if (isEditing) borderClass += ' tapestry-note-card--editing'
  if (isConnectTarget) borderClass += ' tapestry-note-card--connect-target'
  borderClass += ' tapestry-note-card--ink'
  if (faceShown) borderClass += ' tapestry-note-card--flipped'
  if (formFade) borderClass += ` tap-form-fade-${formFade}`

  const cardStyle: React.CSSProperties = {
    left: `${effectiveX}px`,
    top: `${effectiveY}px`,
    ...(effectiveWidth ? { width: `${effectiveWidth}px`, minWidth: `${MIN_WIDTH}px`, maxWidth: 'none' } : {}),
    ...(effectiveHeight ? { height: `${effectiveHeight}px`, minHeight: `${MIN_HEIGHT}px` } : {}),
    // A container is drawn large enough for what is inside it (nesting.ts).
    ...(minSize
      ? {
          minWidth: `${Math.max(MIN_WIDTH, minSize.width)}px`,
          minHeight: `${Math.max(MIN_HEIGHT, minSize.height)}px`,
          maxWidth: 'none',
        }
      : {}),
  }

  return (
    <div
      ref={cardRef}
      className={borderClass}
      style={cardStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerDownCapture={localPoint}
      onContextMenu={handleContextMenu}
    >
      {/* Paper, hover bloom and the pencil outline (Line Lab v2 wave 2) */}
      {outline && (
        <NoteInk
          shape={outline}
          w={box.w}
          h={box.h}
          seed={seed}
          light={light}
          blue={blue}
          blueFromT={blueFromTRef.current}
        />
      )}

      {/* Move particles while dragged (Line Lab v2 wave 6) */}
      {box.w > 0 && (
        <MoveParticles x={effectiveX} y={effectiveY} w={box.w} h={box.h} zoom={zoom} dragging={dragging} />
      )}

      {/* Drag handle area -- the top border strip */}
      <div
        className="tapestry-note-drag-handle"
        onPointerDown={handleDragStart}
        onClick={handleBorderClick}
      />

      {/* Editable title, with the chat button beside it (D-19) */}
      <div className="tapestry-note-title-row" style={{ paddingRight: blue ? 64 : 0 }}>
        <input
          type="text"
          className="tapestry-note-title-input"
          style={{ flex: 1, minWidth: 0 }}
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
        <AskClaudeButton label={askLabel} onAsk={askClaude} />
      </div>

      {/* The ink rule under the title */}
      <div className="tapestry-note-rule" aria-hidden="true">
        {rule && <InkLine shape={rule} seed={seed + 2} />}
      </div>

      {/* ProseMirror body editor */}
      <div
        className="tapestry-note-editor"
        ref={editorRef}
        onClick={handleEditorClick}
      />

      {/* Provenance footer (D-06, D-07): who made this note, read from the
          journal rather than from anything stored on the note itself. */}
      {provenanceFooter}

      {/* The back of the note: its settings (Line Lab v2 wave 3) */}
      <NoteSettings open={settingsOpen} onClose={closeSettings} onShownChange={setFaceShown} />

      {/* The format bar: `f`, the settings button and the pill (D-24) */}
      {blue && box.w > 0 && (
        <FormatBar
          view={editorView}
          w={box.w}
          seed={seed}
          editing={isEditing}
          redHover={redHover}
          settingsOpen={settingsOpen}
          onToggleSettings={toggleSettings}
          onStartEditing={onStartEditing}
        />
      )}

      {/* Corner cluster (D-06): the red delete dot and the blue connect dot */}
      {showControlsBool && (
        <CornerCluster
          onConnect={onStartConnection}
          onDelete={onDeleteNote}
          hasTextSelection={hasTextSelection}
          seed={seed}
          noteLength={outline ? outline.L : 0}
          onRedHoverChange={setRedHover}
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
