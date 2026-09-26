/**
 * Canvas -- the space the trees live in: one infinite 2D plane with
 * CSS-transform pan/zoom (D-05), holding one frame per open tree (D-15).
 *
 * Pan: drag empty space, or a frame's background (1:1, never eased).
 * Zoom: Ctrl+wheel or pinch, gliding around the pointer position.
 * Roll: Shift+wheel about the pointer; Q and E turn 15 degrees and 0 levels,
 * about the viewport centre. A roll released near a quarter turn settles on it.
 *
 * Canvas owns what is global to the space -- the camera, which note is
 * hovered, selected or being connected -- and TreeFrame owns what belongs to
 * one tree. Every piece of per-note state is keyed by `nodeKey` rather than by
 * node id, because ids are only unique inside a tree: two worlds both have an
 * `n1`, and a bare id would make one note's hover highlight another's.
 *
 * Pan, zoom and roll live in ../layout/camera. Input moves a target camera
 * held by a CameraRig; one animation loop glides the drawn camera after it,
 * and the screen and every hit test use the drawn camera (the `view` state).
 * Frame-local coordinates are world coordinates minus the frame's origin.
 */

import React, {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import ConnectionLine from './ConnectionLine'
import SelectionBar from './SelectionBar'
import TreeFrame, { type TreeFrameHandlers, type TreeSubspaces } from './TreeFrame'
import type { ForestTree, NodeRef } from '../state/use-forest'
import { nodeKey } from '../state/use-forest'
import {
  FRAME_GAP,
  computeFrameBounds,
  placeNewFrame,
  type ContentBox,
  type FramePosition,
  type FrameRect,
  type PositionedRect,
} from '../layout/frames'
import { buildFrameMoveBatch, originAfterFit } from '../layout/frame-moves'
import { displayPositions, type DisplaySpot } from '../layout/placement'
import {
  buildNesting,
  INSIDE_KEY,
  isNested,
  MAX_NESTING_DEPTH,
  NESTABLE_TYPE,
  type NestingOp,
} from '../layout/nesting'
import { isZoomPinchDelta, normalizeWheelDelta, panDelta, zoomFactor } from '../layout/wheel'
import {
  CameraRig,
  FLY_TAU_MS,
  IDENTITY_CAMERA,
  ROLL_KEY_STEP_DEG,
  ZOOM_TAU_MS,
  cameraTransformCss,
  centerOn,
  panBy,
  rollDeltaFromWheel,
  screenDeltaToWorld,
  screenToWorld,
  zoomAbout,
  type Camera,
} from '../layout/camera'
import { absolutePositions, isWorkspaceNode, subspaceRects, type DimsOf, type Point } from '../layout/subspaces'
import { flightProgress, type FlightFrame } from '../look/enter'
import { useContextMenu } from './ContextMenu'
import { ChatContext } from '../state/chat'
import EdgeArrowLayer, { type EdgeArrowSessionCard } from './EdgeArrowLayer'
import { PANEL_COLUMN, type ViewportSize } from '../layout/edge-arrows'
import { chatSessionKey } from '../state/chat-sessions'
import { NEW_SESSION_TITLE, SESSION_HEIGHT, SESSION_WIDTH, isSessionNode } from '../../shared/chat/transcript'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeInfo {
  id: string
  type: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

export interface EdgeInfo {
  id: string
  from: string
  to: string
  label: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

/**
 * What the space can be asked to do from outside it.
 *
 * Canvas owns the camera, so panning is its to perform: App knows
 * which tree it just added, not where that tree's frame ended up.
 */
export interface CanvasHandle {
  /** Center a tree's frame in the viewport at the current zoom. */
  panToFrame(treeId: string): void
  /**
   * Center one note in the viewport at the current zoom (open_file, 02.7
   * SC2). A workspace note's position is folder-local, so its world centre is
   * the frame origin plus its absolute position plus half its size.
   */
  panToNote(treeId: string, nodeId: string): void
}

/** The size a note is centred with before it has been measured. */
const PAN_TO_NOTE_FALLBACK = Object.freeze({ width: 280, height: 200 })

/** Where a double-click landed: inside a frame, or nowhere in particular. */
export interface DoubleClickTarget {
  /** Null when no tree is open at all. */
  treeId: string | null
  /** Frame-local coordinates when treeId is set. */
  x: number
  y: number
}

interface CanvasProps {
  trees: ForestTree[]
  editingRef: NodeRef | null
  /** Map of node types to component names from loaded plugins. */
  pluginNodeViews: Record<string, string>
  /** The actor id this person's own changes are signed with (D-07). */
  currentUserActorId: string | null
  onStartEditing: (ref: NodeRef) => void
  onStopEditing: () => void
  onCanvasDoubleClick: (target: DoubleClickTarget) => void
  /**
   * "Start a thread" from the space's own menu (02.3 D-01, UI-SPEC canvas-menu
   * copy): the same target shape as a double-click, local to the frame under
   * the pointer, or `treeId: null` when the pointer is outside every frame.
   */
  onStartThread?: (target: DoubleClickTarget) => void
  /** The selected note changed, so undo/redo knows which tree to act on. */
  onSelectedNoteChange: (ref: NodeRef | null) => void
  onSave: (ref: NodeRef, body: string, title: string) => Promise<void>
  onMarkDirty: (ref: NodeRef) => void
  onMarkClean: (ref: NodeRef) => void
  onPositionChange: (ref: NodeRef, x: number, y: number) => void | Promise<void>
  /**
   * Called when a person drops, or left/top-resizes, a note that follows its
   * parent (D-03, D-16). Must persist position.x, position.y AND pinned=true
   * in a single commit, so the note stops following.
   */
  onTakeOverPosition: (ref: NodeRef, x: number, y: number) => void | Promise<void>
  onWidthChange: (ref: NodeRef, width: number) => void | Promise<void>
  onHeightChange: (ref: NodeRef, height: number) => void | Promise<void>
  /**
   * Called once when a thread center drag ends (D-17). Must persist
   * position.x, position.y AND pinned=true in a single commit.
   */
  onPinnedPositionChange: (ref: NodeRef, x: number, y: number) => void
  onEdgeCreate: (from: NodeRef, to: NodeRef) => void
  /** Called when a note is deleted via the delete bubble or keyboard. */
  onDeleteNote: (ref: NodeRef) => void
  /** Called when a fallback node property is edited inline (D-35). */
  onPropertyEdit: (
    ref: NodeRef,
    key: string,
    type: string,
    value: string | number | boolean,
  ) => void
  /** Move a frame in renderer state only; the canvas persists the final spot. */
  onFrameMove: (treeId: string, x: number, y: number) => void
  /**
   * Called with the result of every recorded batch (2.6 D-08, D-11), and
   * whether the person dragged the frame (`frameMoved`) or a note grew it.
   * App arms frame undo only for a committed drag, since a push from a note
   * change is part of that tree edit (review WR-04), and shows the failure
   * otherwise.
   */
  onFramesMoved: (
    result: { ok: boolean; committed?: boolean; error?: string },
    frameMoved: boolean,
  ) => void
  /**
   * Close a tree (Tree options, or an unavailable frame's actions). App
   * waits for main's answer and shows a refusal notice (4.9) or the error,
   * so a close never fails silently (review WR-03).
   */
  onCloseTree: (treeId: string) => void
  /**
   * Collapse or expand a workspace folder frame (02.7 D-21); `collapsed` is the
   * state wanted. Resolves once the commit is in and the tree refreshed, so the
   * space can settle around the frame's new size.
   */
  onToggleFolder: (treeId: string, folderId: string, collapsed: boolean, dimsOf: DimsOf) => Promise<void>
  /**
   * A folder frame was dropped at `local` (in its parent's space): one commit
   * moving it, and whatever it displaced (02.7 D-21). Resolves once the tree
   * has been refreshed, so the live drag position can be let go without a jump.
   */
  onFolderDrop: (treeId: string, folderId: string, local: Point, dimsOf: DimsOf) => Promise<void>
  /** A note moved into or out of another note: submit these ops as one commit (nesting.ts). */
  onNestingMove: (ref: NodeRef, ops: NestingOp[]) => void | Promise<void>
  /** Make a note inside `container`, at a spot local to it. */
  onCreateInside: (container: NodeRef, x: number, y: number) => void
  /**
   * Notes carried along by a group drag, dropped together: one commit per
   * tree. `pin` marks a note that was following its parent (D-03), which a
   * person moving it takes over, as a single move does.
   */
  onMoveNotes: (moves: ReadonlyArray<{ ref: NodeRef; x: number; y: number; pin: boolean }>) => Promise<void>
  /** The selected frame, which is the space's focal point and undo target. */
  selectedTreeId: string | null
  onSelectTree: (treeId: string | null) => void
  /**
   * Workspace folders drawn open for this view only, per tree, whatever their
   * stored `collapsed` says (open_file's reveal; never committed).
   */
  revealedFolders?: ReadonlyMap<string, ReadonlySet<string>>
  /** open_file's request to open one file window (02.7 SC2). */
  openRequest?: { key: string; nonce: number } | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.1
const MAX_ZOOM = 5
/** How much of the viewport's smaller side "Zoom into note" fills. */
const ZOOM_FIT_SHARE = 0.85

const DEFAULT_NODE_WIDTH = 240
const DEFAULT_NODE_HEIGHT = 80
/** The drawn-spot map for a tree that has none yet (D-05). */
const NO_DISPLAY_SPOTS: ReadonlyMap<string, DisplaySpot> = new Map()

/**
 * The empty space (UI-SPEC "Empty state body").
 *
 * One string rather than wrapped JSX text, so the approved copy stays one
 * greppable line: it names the way in to a vault, which is the whole point of
 * saying anything here at all.
 */
const EMPTY_BODY =
  'Create notes, connect ideas, and build your world of thought. ' +
  'To bring in an Obsidian vault, choose Add tree, then Add Obsidian Vault.'

/** Backgrounds a pan, a deselect or a create may start from. */
const BACKGROUND_CLASSES = [
  'tapestry-canvas-container',
  'tapestry-tree-frame',
  'tapestry-tree-frame-content',
]

function isBackground(target: HTMLElement, viewport: HTMLElement | null): boolean {
  if (target === viewport) return true
  return BACKGROUND_CLASSES.some((cls) => target.classList.contains(cls))
}

/**
 * True when a key event is aimed at something the person is typing into, so
 * a canvas shortcut must leave the key alone.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('.ProseMirror, input, textarea, select, [contenteditable]') !== null
}

function containsPoint(rect: FrameRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

function Canvas({
  trees,
  editingRef,
  pluginNodeViews,
  currentUserActorId,
  onStartEditing,
  onStopEditing,
  onCanvasDoubleClick,
  onStartThread,
  onSelectedNoteChange,
  onSave,
  onMarkDirty,
  onMarkClean,
  onPositionChange,
  onTakeOverPosition,
  onWidthChange,
  onHeightChange,
  onPinnedPositionChange,
  onEdgeCreate,
  onDeleteNote,
  onPropertyEdit,
  onFrameMove,
  onFramesMoved,
  onCloseTree,
  onToggleFolder,
  onFolderDrop,
  onNestingMove,
  onCreateInside,
  onMoveNotes,
  selectedTreeId,
  onSelectTree,
  revealedFolders,
  openRequest,
}: CanvasProps, ref: React.ForwardedRef<CanvasHandle>): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null)
  // The drawn camera: what the screen shows and what hit tests invert.
  const [view, setView] = useState<Camera>(IDENTITY_CAMERA)
  // The target camera and the ease toward it. Created once; every camera
  // write goes through it.
  const [rig] = useState(() => new CameraRig(IDENTITY_CAMERA))
  const rafRef = useRef(0)
  const lastFrameRef = useRef(0)

  /** Show the drawn camera now, for direct moves that need no animation. */
  const showDrawn = useCallback(() => {
    setView({ ...rig.drawn })
  }, [rig])

  /**
   * The shared-element flight riding the current glide, if any (entering a
   * note, look/enter.ts). Each frame it is told how far the drawn camera has
   * come; it ends on landing, or where it is when other input moves the
   * target. `entered` remembers where the camera was before the last note
   * was entered, so Escape can fly back out.
   */
  const flightRef = useRef<{ from: Camera; to: Camera; onFlight: (f: FlightFrame) => void } | null>(null)
  const enteredRef = useRef<{ from: Camera; onFlight: (f: FlightFrame) => void } | null>(null)

  const advanceFlight = useCallback(
    (more: boolean) => {
      const f = flightRef.current
      if (!f) return
      const t = rig.target
      const interrupted = t.zoom !== f.to.zoom || t.panX !== f.to.panX || t.panY !== f.to.panY || t.roll !== f.to.roll
      const done = interrupted || !more
      f.onFlight({ p: done ? 1 : flightProgress(f.from, f.to, rig.drawn), fromZoom: f.from.zoom, toZoom: f.to.zoom })
      if (done) flightRef.current = null
    },
    [rig],
  )

  /** Start a flight along the glide just set on the rig, ending any other. */
  const startFlight = useCallback(
    (from: Camera, onFlight: (f: FlightFrame) => void) => {
      const prev = flightRef.current
      if (prev) prev.onFlight({ p: 1, fromZoom: prev.from.zoom, toZoom: prev.to.zoom })
      const to = { ...rig.target }
      flightRef.current = { from, to, onFlight }
      onFlight({ p: 0, fromZoom: from.zoom, toZoom: to.zoom })
    },
    [rig],
  )

  /**
   * Start the animation loop if it is not running. Each frame advances the
   * drawn camera by the real elapsed time; the loop stops as soon as the
   * camera has arrived, so an idle canvas schedules no frames.
   */
  const kick = useCallback(() => {
    if (rafRef.current !== 0) return
    lastFrameRef.current = performance.now()
    const frame = (now: number) => {
      const dt = Math.max(0, now - lastFrameRef.current)
      lastFrameRef.current = now
      const more = rig.tick(now, dt)
      advanceFlight(more)
      setView({ ...rig.drawn })
      rafRef.current = more ? requestAnimationFrame(frame) : 0
    }
    rafRef.current = requestAnimationFrame(frame)
  }, [rig, advanceFlight])

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    },
    [],
  )

  // Panning state: the last pointer position a background pan moved to.
  const isPanningRef = useRef(false)
  const lastPanPointRef = useRef({ x: 0, y: 0 })

  // Connection-creation state. Refs, not ids: a connection names two notes,
  // and the tree is half of each name.
  const [connectingFrom, setConnectingFrom] = useState<NodeRef | null>(null)
  const [connectingLine, setConnectingLine] = useState<{ x: number; y: number } | null>(null)
  const [connectingHover, setConnectingHover] = useState<NodeRef | null>(null)
  // The "landed" event: the tree a connection was just made in, and when.
  // Its new line flashes green, then rests blue (Line Lab v2 wave 4).
  const [landed, setLanded] = useState<{ treeId: string; at: number } | null>(null)

  // Hovered / selected note, keyed across every tree in the space.
  const [hoveredRef, setHoveredRef] = useState<NodeRef | null>(null)
  // Every selected note, in the order selected. A plain click selects one; a
  // Shift, Cmd or Ctrl click adds or removes one. The newest is the one undo
  // and the app treat as "the" selected note.
  const [selectedRefs, setSelectedRefs] = useState<NodeRef[]>([])
  const selectedRefsRef = useRef(selectedRefs)
  selectedRefsRef.current = selectedRefs
  // Whether the last pointer press held a modifier that extends a selection.
  // Card clicks reach Canvas as bare callbacks, so the press is read here.
  const extendRef = useRef(false)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      extendRef.current = e.shiftKey || e.metaKey || e.ctrlKey
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [])

  // A group drag: the selected notes the dragged one carries with it, each
  // with where it started, and where they are drawn while it moves.
  const groupRef = useRef<{
    lead: string
    leadStart: Point
    members: Array<{ ref: NodeRef; start: Point; pin: boolean }>
  } | null>(null)
  const [followerPositions, setFollowerPositions] = useState<Record<string, Point>>({})

  // Live drag positions (frame-local), keyed by nodeKey.
  const [dragPositions, setDragPositions] = useState<
    Record<string, { x: number; y: number }>
  >({})
  const dragPositionsRef = useRef(dragPositions)
  const followerPositionsRef = useRef<Record<string, Point>>({})
  // Each tree's drawn spots, reused while its inputs are unchanged.
  const spotsCacheRef = useRef(
    new Map<string, { nodes: unknown; edges: unknown; sig: string; spots: ReadonlyMap<string, DisplaySpot> }>(),
  )
  const treeSpotsRef = useRef(new Map<string, ReadonlyMap<string, DisplaySpot>>())
  const subspacesCacheRef = useRef(
    new Map<string, { nodes: unknown; revealed: unknown; sig: string; dimsSig: string; value: TreeSubspaces }>(),
  )
  // Per-tree slices of canvas-wide state, reused while unchanged so a frame
  // whose own slice did not change skips rendering.
  const sliceCacheRef = useRef(new Map<string, { sig: string; value: unknown }>())
  const slice = <T,>(cacheKey: string, sig: string, make: () => T): T => {
    const cached = sliceCacheRef.current.get(cacheKey)
    if (cached && cached.sig === sig) return cached.value as T
    const value = make()
    sliceCacheRef.current.set(cacheKey, { sig, value })
    return value
  }

  // Frame-level state (D-15). A frame is dragged by its header, selected by a
  // click on it, and never deleted by the Delete key.
  const [draggingTreeId, setDraggingTreeId] = useState<string | null>(null)
  const [hoveredTreeId, setHoveredTreeId] = useState<string | null>(null)
  const frameDragRef = useRef({ startX: 0, startY: 0, originX: 0, originY: 0, moved: false })

  // A folder frame dragged by its header (02.7 D-21). Its live local position
  // rides in dragPositions, like a card's, so the frame, its contents and the
  // workspace frame's bounds all follow the pointer together.
  const [draggingFolder, setDraggingFolder] = useState<NodeRef | null>(null)
  const folderDragRef = useRef({ startX: 0, startY: 0, originX: 0, originY: 0, moved: false })

  // Trees the renderer has already placed with real bounds, so a frame is
  // repositioned once when it appears and not on every later render.
  const placedRef = useRef(new Set<string>())

  // Node dimensions cache for connection-line centers, keyed by nodeKey.
  const nodeDimsRef = useRef<Map<string, { width: number; height: number }>>(new Map())

  const getDims = useCallback(
    (key: string) => nodeDimsRef.current.get(key),
    [],
  )

  const registerNodeDims = useCallback((ref: NodeRef, width: number, height: number) => {
    nodeDimsRef.current.set(nodeKey(ref), { width, height })
  }, [])

  /** One tree's measured card sizes, by bare node id, for subspace geometry. */
  const dimsOfTree = useCallback(
    (treeId: string): DimsOf =>
      (nodeId: string) =>
        nodeDimsRef.current.get(nodeKey({ treeId, nodeId })),
    [],
  )

  // Trees whose frame changed size in a commit that has just landed: they are
  // settled among the other frames on the next render, once the refreshed
  // nodes are what the rects are computed from.
  const pendingSettleRef = useRef(new Set<string>())
  const [settleTick, setSettleTick] = useState(0)
  const requestSettle = useCallback((treeId: string) => {
    pendingSettleRef.current.add(treeId)
    setSettleTick((tick) => tick + 1)
  }, [])

  /**
   * A note's own stored spot (container-local), before any live drag: where a
   * group member starts from. A following note starts where it is drawn.
   */
  const startSpot = (ref: NodeRef): { at: Point; following: boolean } | null => {
    const tree = treesRef.current.find((t) => t.id === ref.treeId)
    const node = tree?.nodes.find((n) => n.id === ref.nodeId)
    if (!tree || !node) return null
    const stored = {
      x: Number(node.props['position.x']?.value ?? 0),
      y: Number(node.props['position.y']?.value ?? 0),
    }
    if (node.props[INSIDE_KEY] !== undefined) return { at: stored, following: false }
    const spot = treeSpotsRef.current.get(ref.treeId)?.get(ref.nodeId)
    if (spot?.following === true) return { at: { x: spot.x, y: spot.y }, following: true }
    return { at: stored, following: false }
  }

  /**
   * The selected notes a drag of `lead` carries: every other selected note of
   * the note type, except one inside another selected note, which moves with
   * its container already.
   */
  const groupFor = (lead: NodeRef): NonNullable<typeof groupRef.current> | null => {
    const selected = selectedRefsRef.current
    const leadKey = nodeKey(lead)
    if (selected.length < 2 || !selected.some((r) => nodeKey(r) === leadKey)) return null
    const leadStart = startSpot(lead)
    if (!leadStart) return null
    const chosen = new Set(selected.map(nodeKey))
    const members: Array<{ ref: NodeRef; start: Point; pin: boolean }> = []
    for (const ref of selected) {
      if (nodeKey(ref) === leadKey) continue
      const tree = treesRef.current.find((t) => t.id === ref.treeId)
      if (!tree || tree.kind === 'workspace') continue
      const byId = new Map(tree.nodes.map((n) => [n.id, n]))
      const node = byId.get(ref.nodeId)
      if (!node || node.type !== NESTABLE_TYPE) continue
      let parent: unknown = node.props[INSIDE_KEY]?.value
      let carried = false
      for (let depth = 0; typeof parent === 'string' && depth < MAX_NESTING_DEPTH; depth += 1) {
        if (chosen.has(nodeKey({ treeId: ref.treeId, nodeId: parent }))) {
          carried = true
          break
        }
        parent = byId.get(parent)?.props[INSIDE_KEY]?.value
      }
      if (carried) continue
      const start = startSpot(ref)
      if (start) members.push({ ref, start: start.at, pin: start.following })
    }
    return members.length > 0 ? { lead: leadKey, leadStart: leadStart.at, members } : null
  }

  const handleDragMove = (ref: NodeRef, x: number, y: number) => {
    const key = nodeKey(ref)
    if (groupRef.current?.lead !== key && !dragPositionsRef.current[key]) {
      groupRef.current = groupFor(ref)
    }
    setDragPositions((prev) => ({ ...prev, [key]: { x, y } }))
    const group = groupRef.current
    if (group?.lead === key) {
      const dx = x - group.leadStart.x
      const dy = y - group.leadStart.y
      const next: Record<string, Point> = {}
      for (const member of group.members) {
        next[nodeKey(member.ref)] = { x: member.start.x + dx, y: member.start.y + dy }
      }
      setFollowerPositions(next)
    }
  }

  const handleDragEnd = (ref: NodeRef) => {
    const key = nodeKey(ref)
    setDragPositions((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    const group = groupRef.current
    if (group?.lead !== key) return
    groupRef.current = null
    const moves = group.members.flatMap((member) => {
      const at = followerPositionsRef.current[nodeKey(member.ref)]
      return at ? [{ ref: member.ref, x: at.x, y: at.y, pin: member.pin }] : []
    })
    if (moves.length === 0) {
      setFollowerPositions({})
      return
    }
    // Hold the followers where they were dropped until the commit is back,
    // so they do not flick to their old spots in between.
    void onMoveNotes(moves)
      .catch(() => undefined)
      .then(() => {
        setFollowerPositions({})
        for (const treeId of new Set(moves.map((m) => m.ref.treeId))) requestSettle(treeId)
      })
  }

  const selectNote = useCallback(
    (ref: NodeRef | null) => {
      setSelectedRefs(ref ? [ref] : [])
      onSelectedNoteChange(ref)
    },
    [onSelectedNoteChange],
  )

  /** Add a note to the selection, or take it out if it is already in. */
  const toggleNote = useCallback(
    (ref: NodeRef) => {
      const key = nodeKey(ref)
      const prev = selectedRefsRef.current
      const next = prev.some((r) => nodeKey(r) === key)
        ? prev.filter((r) => nodeKey(r) !== key)
        : [...prev, ref]
      setSelectedRefs(next)
      onSelectedNoteChange(next.length > 0 ? next[next.length - 1] : null)
    },
    [onSelectedNoteChange],
  )

  // -----------------------------------------------------------------------
  // Frame rects, recomputed from live content bounds every render
  // -----------------------------------------------------------------------

  dragPositionsRef.current = dragPositions
  followerPositionsRef.current = followerPositions

  const frameRects = new Map<string, FrameRect>()
  // D-05: where every note is drawn, computed once per tree so frame bounds,
  // edges, knot midpoints and cards all agree on a following note's spot.
  const treeSpots = new Map<string, ReadonlyMap<string, DisplaySpot>>()
  // 02.7 D-21: a workspace tree's folder frames, computed once per render and
  // shared by the tree frame's bounds and its nested FolderFrames.
  const treeSubspaces = new Map<string, TreeSubspaces>()
  for (const tree of trees) {
    const overrides = new Map<string, { x: number; y: number }>()
    for (const node of tree.nodes) {
      const key = nodeKey({ treeId: tree.id, nodeId: node.id })
      const drag = dragPositions[key] ?? followerPositions[key]
      if (drag) overrides.set(node.id, drag)
    }
    // Reused while this tree and its live drags are unchanged, so the tree's
    // frame can skip rendering (see TreeFrame's sameFrameProps).
    const overridesSig = JSON.stringify([...overrides])
    const cachedSpots = spotsCacheRef.current.get(tree.id)
    const spots =
      cachedSpots && cachedSpots.nodes === tree.nodes && cachedSpots.edges === tree.edges && cachedSpots.sig === overridesSig
        ? cachedSpots.spots
        : displayPositions(tree.nodes, tree.edges, overrides)
    spotsCacheRef.current.set(tree.id, { nodes: tree.nodes, edges: tree.edges, sig: overridesSig, spots })
    treeSpots.set(tree.id, spots)

    if (tree.kind === 'workspace') {
      const positions: ReadonlyMap<string, Point> = overrides
      const revealed = revealedFolders?.get(tree.id)
      const draggingFolderId = draggingFolder?.treeId === tree.id ? draggingFolder.nodeId : null
      // The layout reads measured sizes, so they are part of what it is reused on.
      const dimsSig = tree.nodes
        .map((node) => {
          const d = nodeDimsRef.current.get(nodeKey({ treeId: tree.id, nodeId: node.id }))
          return d ? `${d.width}x${d.height}` : ''
        })
        .join(',')
      const cachedSub = subspacesCacheRef.current.get(tree.id)
      const subspaces =
        cachedSub &&
        cachedSub.nodes === tree.nodes &&
        cachedSub.revealed === revealed &&
        cachedSub.sig === overridesSig &&
        cachedSub.dimsSig === dimsSig &&
        cachedSub.value.draggingFolderId === draggingFolderId
          ? cachedSub.value
          : {
              layout: subspaceRects(tree.nodes, dimsOfTree(tree.id), revealed, positions),
              positions,
              draggingFolderId,
            }
      subspacesCacheRef.current.set(tree.id, { nodes: tree.nodes, revealed, sig: overridesSig, dimsSig, value: subspaces })
      const layout = subspaces.layout
      treeSubspaces.set(tree.id, subspaces)
      // The workspace root's cards and top-level folder frames, plus any note
      // made in the workspace tree that is not a workspace file.
      const others: ContentBox[] = tree.nodes
        .filter((node) => !isWorkspaceNode(node))
        .map((node) => {
          const dims = nodeDimsRef.current.get(nodeKey({ treeId: tree.id, nodeId: node.id }))
          const at = overrides.get(node.id)
          return {
            x: at ? at.x : Number(node.props['position.x']?.value ?? 0),
            y: at ? at.y : Number(node.props['position.y']?.value ?? 0),
            width: dims?.width ?? DEFAULT_NODE_WIDTH,
            height: dims?.height ?? DEFAULT_NODE_HEIGHT,
          }
        })
      frameRects.set(tree.id, computeFrameBounds(tree.frame, [...layout.rootBoxes, ...others]))
      continue
    }

    // A note inside another note is inside that note's drawn box, which is
    // measured grown to hold it, so only top-level notes size the frame.
    const nesting = buildNesting(tree.nodes)
    const boxes: ContentBox[] = tree.nodes.filter((node) => !isNested(nesting, node.id)).map((node) => {
      const key = nodeKey({ treeId: tree.id, nodeId: node.id })
      const drag = dragPositions[key]
      const spot = spots.get(node.id)
      const dims = nodeDimsRef.current.get(key)
      return {
        x: spot ? spot.x : drag ? drag.x : Number(node.props['position.x']?.value ?? 0),
        y: spot ? spot.y : drag ? drag.y : Number(node.props['position.y']?.value ?? 0),
        width: dims?.width ?? DEFAULT_NODE_WIDTH,
        height: dims?.height ?? DEFAULT_NODE_HEIGHT,
      }
    })
    frameRects.set(tree.id, computeFrameBounds(tree.frame, boxes))
  }

  /**
   * The rects this render computed, readable by an imperative caller later.
   *
   * panToFrame is called after a frame has been added and possibly nudged
   * clear of its neighbours, so it must read the rects as they are at that
   * moment rather than the ones its own closure was created with.
   */
  const frameRectsRef = useRef(frameRects)
  frameRectsRef.current = frameRects
  treeSpotsRef.current = treeSpots

  /**
   * Fly to a frame: glide the camera so the frame's midpoint sits at the
   * viewport's centre, keeping the current zoom and roll.
   */
  const panToFrame = useCallback(
    (treeId: string) => {
      const viewport = viewportRef.current
      const rect = frameRectsRef.current.get(treeId)
      if (!viewport || !rect) return

      const { clientWidth, clientHeight } = viewport
      rig.easeTo(
        (c) =>
          centerOn(c, rect.x + rect.width / 2, rect.y + rect.height / 2, clientWidth, clientHeight),
        FLY_TAU_MS,
      )
      kick()
    },
    [rig, kick],
  )

  const treesRef = useRef(trees)
  treesRef.current = trees

  const panToNote = useCallback((treeId: string, nodeId: string) => {
    const viewport = viewportRef.current
    const tree = treesRef.current.find((t) => t.id === treeId)
    if (!viewport || !tree) return
    const node = tree.nodes.find((n) => n.id === nodeId)
    if (!node) return

    const local =
      tree.kind === 'workspace'
        ? absolutePositions(tree.nodes).get(nodeId)
        : { x: Number(node.props['position.x']?.value ?? 0), y: Number(node.props['position.y']?.value ?? 0) }
    if (!local) return
    const dims = nodeDimsRef.current.get(nodeKey({ treeId, nodeId })) ?? PAN_TO_NOTE_FALLBACK
    const cx = tree.frame.x + local.x + dims.width / 2
    const cy = tree.frame.y + local.y + dims.height / 2

    const { clientWidth, clientHeight } = viewport
    setView((prev) => ({
      ...prev,
      panX: clientWidth / 2 - cx * prev.zoom,
      panY: clientHeight / 2 - cy * prev.zoom,
    }))
  }, [])

  /**
   * Fit a frame-local rect to the viewport ("Zoom into note"): zoom so it
   * fills ZOOM_FIT_SHARE of the smaller side, within the zoom limits, and
   * glide its centre to the middle. Keeps the current roll.
   */
  const zoomToFrameRect = useCallback(
    (
      treeId: string,
      rect: { x: number; y: number; width: number; height: number },
      onFlight?: (f: FlightFrame) => void,
    ) => {
      const viewport = viewportRef.current
      const tree = treesRef.current.find((t) => t.id === treeId)
      if (!viewport || !tree || rect.width <= 0 || rect.height <= 0) return
      const { clientWidth, clientHeight } = viewport
      const fit = Math.min(clientWidth / rect.width, clientHeight / rect.height) * ZOOM_FIT_SHARE
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit))
      const cx = tree.frame.x + rect.x + rect.width / 2
      const cy = tree.frame.y + rect.y + rect.height / 2
      const from = { ...rig.drawn }
      rig.easeTo((c) => centerOn({ ...c, zoom }, cx, cy, clientWidth, clientHeight), FLY_TAU_MS)
      // With a flight, the note's parts fly with the glide, and Escape can
      // fly back to where the camera was (look/enter.ts).
      if (onFlight) {
        startFlight(from, onFlight)
        if (!enteredRef.current) enteredRef.current = { from, onFlight }
        else enteredRef.current = { from: enteredRef.current.from, onFlight }
      }
      kick()
    },
    [rig, kick, startFlight],
  )

  /** Leave the entered note: fly back to the camera from before it was entered. */
  const leaveNote = useCallback((): boolean => {
    const entered = enteredRef.current
    if (!entered) return false
    enteredRef.current = null
    const from = { ...rig.drawn }
    rig.easeTo(() => ({ ...entered.from }), FLY_TAU_MS)
    startFlight(from, entered.onFlight)
    kick()
    return true
  }, [rig, kick, startFlight])

  // Escape leaves an entered note, once nothing is being typed in (the first
  // Escape stops editing; App handles that).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !enteredRef.current) return
      const active = document.activeElement
      if (active && active.closest('.ProseMirror, input, textarea, [contenteditable="true"]')) return
      leaveNote()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leaveNote])

  useImperativeHandle(ref, () => ({ panToFrame, panToNote }), [panToFrame, panToNote])

  /** The tree whose frame contains a world point, if any. */
  const treeAt = useCallback(
    (worldX: number, worldY: number): ForestTree | null => {
      // Reverse order: the most recently opened frame is on top.
      for (let i = trees.length - 1; i >= 0; i -= 1) {
        const rect = frameRects.get(trees[i].id)
        if (rect && containsPoint(rect, worldX, worldY)) return trees[i]
      }
      return null
    },
    // frameRects is rebuilt each render alongside trees/dragPositions.
    [trees, dragPositions],
  )

  const pointerWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      if (!viewportRef.current) return null
      const rect = viewportRef.current.getBoundingClientRect()
      // The drawn camera, so a click lands where the content appears.
      return screenToWorld(view, clientX - rect.left, clientY - rect.top)
    },
    [view],
  )

  /** Every frame's world rect, in the shape push-apart works on. */
  const positionedRects = (): PositionedRect[] => {
    const rects: PositionedRect[] = []
    for (const tree of trees) {
      const rect = frameRects.get(tree.id)
      if (rect) rects.push({ id: tree.id, ...rect })
    }
    return rects
  }

  /**
   * Record the space around a frame that just moved or grew (D-15), as one
   * forest commit (2.6 D-11).
   *
   * The batch holds the frame at `movedOrigin` first and every frame it
   * pushed aside after it (the arithmetic is buildFrameMoveBatch's). The
   * pushed frames move here at once; the moved frame is already where the
   * pointer left it. One call sends the whole batch, so one undo can put the
   * whole drop back. Main signs it; nothing here names an actor.
   *
   * When a note grows its frame (`frameMoved` false) and pushes nothing
   * aside, there is nothing to record and no call is made.
   */
  const recordFrameMoves = (
    movedTreeId: string,
    movedOrigin: FramePosition,
    frameMoved: boolean,
  ) => {
    const batch = buildFrameMoveBatch(trees, positionedRects(), movedTreeId, movedOrigin)
    for (const move of batch.slice(1)) onFrameMove(move.treeId, move.x, move.y)
    if (!frameMoved && batch.length === 1) return

    // App arms frame undo on a commit and shows the approved notice (4.12)
    // on a failure, putting every frame back where the forest has it.
    void window.tapestry.trees.moveFrames(batch).then(
      (result) => onFramesMoved(result, frameMoved),
      (err: unknown) =>
        onFramesMoved(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          frameMoved,
        ),
    )
  }

  /** A note landed or resized: its frame may now crowd a neighbour. */
  const recordFrameGrowth = (treeId: string) => {
    const tree = trees.find((t) => t.id === treeId)
    if (tree) recordFrameMoves(treeId, { x: tree.frame.x, y: tree.frame.y }, false)
  }

  useEffect(() => {
    if (pendingSettleRef.current.size === 0) return
    const pending = [...pendingSettleRef.current]
    pendingSettleRef.current.clear()
    // A folder opened or closed grew or shrank its workspace frame (02.7
    // D-21): recorded as growth (2.6 D-08), which never arms frame undo.
    for (const treeId of pending) {
      if (trees.some((tree) => tree.id === treeId)) recordFrameGrowth(treeId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleTick, trees])

  /**
   * A tree the renderer has not placed yet gets a real spot.
   *
   * Main puts a new tree at a provisional frame computed from stored positions
   * alone, which cannot know how large the existing frames actually are. Once
   * the renderer has measured them, a frame that landed within the gap of
   * another is moved clear, and main records the fit as the system's, only
   * when the origin actually changes (2.6 D-12).
   *
   * The placedRef guard runs this once per tree id per renderer session, and
   * main relies on it: it gives each member one fit per session. The
   * correction runs at the first render that holds the tree, usually before
   * its notes load, so it measures minimum-size rects at the stored origins.
   * That keeps it deterministic across launches, so a relaunch asks for the
   * spot already stored and writes nothing (RESEARCH Pitfall 7).
   *
   * The fitted origin is applied only when main commits it (originAfterFit).
   * A new renderer session re-runs this for every tree while main's fits are
   * already spent, so a refused or failed fit leaves the frame where the
   * forest has it (review WR-05).
   */
  useEffect(() => {
    if (trees.length === 0) return
    const rects = positionedRects()

    for (const tree of trees) {
      if (placedRef.current.has(tree.id)) continue
      placedRef.current.add(tree.id)

      const mine = rects.find((rect) => rect.id === tree.id)
      const others = rects.filter((rect) => rect.id !== tree.id)
      if (!mine || others.length === 0) continue

      const clashes = others.some(
        (other) =>
          mine.x - FRAME_GAP < other.x + other.width &&
          other.x < mine.x + mine.width + FRAME_GAP &&
          mine.y - FRAME_GAP < other.y + other.height &&
          other.y < mine.y + mine.height + FRAME_GAP,
      )
      if (!clashes) continue

      const spot = placeNewFrame(others)
      const x = tree.frame.x + (spot.x - mine.x)
      const y = tree.frame.y + (spot.y - mine.y)
      const treeId = tree.id
      void window.tapestry.trees.fitFrame(treeId, x, y).then(
        (result) => {
          const origin = originAfterFit(result, { x, y })
          if (origin) onFrameMove(treeId, origin.x, origin.y)
        },
        (err: unknown) => console.error('Frame fit failed:', err),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trees, onFrameMove])

  /** Pointer down on a frame's header band: the start of a frame drag. */
  const handleFrameHeaderPointerDown = (
    treeId: string,
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (e.button !== 0) return
    const tree = trees.find((t) => t.id === treeId)
    if (!tree) return

    // The header is not canvas background: dragging it must not also pan.
    e.stopPropagation()
    e.preventDefault()
    frameDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: tree.frame.x,
      originY: tree.frame.y,
      moved: false,
    }
    setDraggingTreeId(treeId)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  // -----------------------------------------------------------------------
  // Pan handlers
  // -----------------------------------------------------------------------

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      if (!isBackground(e.target as HTMLElement, viewportRef.current)) return

      // A grab stops any glide where it is drawn; the pan then follows the
      // hand from there.
      rig.hold()
      isPanningRef.current = true
      lastPanPointRef.current = { x: e.clientX, y: e.clientY }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      e.preventDefault()
    },
    [rig],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // A folder drag moves the folder's local origin; its contents follow.
      if (draggingFolder) {
        const dx = (e.clientX - folderDragRef.current.startX) / view.zoom
        const dy = (e.clientY - folderDragRef.current.startY) / view.zoom
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) folderDragRef.current.moved = true
        if (folderDragRef.current.moved) {
          handleDragMove(draggingFolder, folderDragRef.current.originX + dx, folderDragRef.current.originY + dy)
        }
        return
      }

      // A frame drag moves the whole tree with its notes and connections, so
      // it is applied to the frame origin rather than to any note.
      if (draggingTreeId) {
        const d = screenDeltaToWorld(
          e.clientX - frameDragRef.current.startX,
          e.clientY - frameDragRef.current.startY,
          view.zoom,
          view.roll,
        )
        // A few pixels of travel separates a drag from a click that selects.
        if (Math.abs(d.x) > 2 || Math.abs(d.y) > 2) frameDragRef.current.moved = true
        onFrameMove(
          draggingTreeId,
          frameDragRef.current.originX + d.x,
          frameDragRef.current.originY + d.y,
        )
        return
      }

      if (connectingFrom) {
        const world = pointerWorld(e.clientX, e.clientY)
        if (world) setConnectingLine(world)
      }

      if (!isPanningRef.current) return
      const dx = e.clientX - lastPanPointRef.current.x
      const dy = e.clientY - lastPanPointRef.current.y
      lastPanPointRef.current = { x: e.clientX, y: e.clientY }
      rig.direct((c) => panBy(c, dx, dy))
      showDrawn()
    },
    [
      connectingFrom,
      pointerWorld,
      draggingTreeId,
      draggingFolder,
      handleDragMove,
      onFrameMove,
      view.zoom,
      view.roll,
      rig,
      showDrawn,
    ],
  )

  // Not memoised: the drop needs this render's frame rects, and a stale
  // closure would settle the space against where the frames used to be.
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    {
      if (isPanningRef.current) {
        isPanningRef.current = false
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      }

      if (draggingFolder) {
        const folderRef = draggingFolder
        const local = dragPositions[nodeKey(folderRef)]
        setDraggingFolder(null)
        if (folderDragRef.current.moved && local) {
          void onFolderDrop(folderRef.treeId, folderRef.nodeId, local, dimsOfTree(folderRef.treeId))
            .catch(() => undefined)
            .then(() => {
              handleDragEnd(folderRef)
              requestSettle(folderRef.treeId)
            })
        } else {
          handleDragEnd(folderRef)
        }
        return
      }

      if (draggingTreeId) {
        const tree = trees.find((t) => t.id === draggingTreeId)
        if (tree) {
          if (frameDragRef.current.moved) {
            recordFrameMoves(tree.id, { x: tree.frame.x, y: tree.frame.y }, true)
          } else {
            // Pressing the header without moving it selects the frame.
            onSelectTree(draggingTreeId)
          }
        }
        setDraggingTreeId(null)
        return
      }

      if (connectingFrom) {
        // A connection joins two notes in one tree. Ending on another tree's
        // note does nothing here; cross-tree links are D-16 (Plan 15), and
        // writing one end of them now would record half a relationship.
        if (connectingHover && connectingHover.treeId === connectingFrom.treeId) {
          setLanded({ treeId: connectingFrom.treeId, at: performance.now() })
          onEdgeCreate(connectingFrom, connectingHover)
        }
        setConnectingFrom(null)
        setConnectingLine(null)
        setConnectingHover(null)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Zoom handler (wheel)
  // -----------------------------------------------------------------------

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      if (e.ctrlKey) {
        // Pinch-to-zoom on trackpad (browser sets ctrlKey for pinch gestures)
        // or Ctrl+wheel. The anchor is computed against the target camera, so
        // a burst of notches stays under the cursor, and the zoom glides.
        const rect = viewport.getBoundingClientRect()
        const pointerX = e.clientX - rect.left
        const pointerY = e.clientY - rect.top
        const normalizedDeltaY = normalizeWheelDelta(e.deltaY, e.deltaMode)
        const factor = zoomFactor(normalizedDeltaY, isZoomPinchDelta(normalizedDeltaY))

        rig.easeTo((c) => zoomAbout(c, factor, pointerX, pointerY, MIN_ZOOM, MAX_ZOOM), ZOOM_TAU_MS)
        kick()
      } else if (e.shiftKey) {
        // Shift+wheel rolls the canvas about the pointer. Shift with a
        // two-finger scroll used to pan sideways; it now rolls, the gesture
        // the design names. Chromium on macOS exposes no trackpad rotate
        // gesture (WebKit's gesturechange exists only in Safari), so roll
        // comes from Shift+wheel, Q/E and 0 rather than a trackpad twist.
        const rect = viewport.getBoundingClientRect()
        rig.roll(
          rollDeltaFromWheel(e.deltaX, e.deltaY, e.deltaMode),
          e.clientX - rect.left,
          e.clientY - rect.top,
          performance.now(),
        )
        kick()
      } else {
        // Two-finger pan is direct manipulation: 1:1, never eased.
        rig.direct((c) =>
          panBy(c, -panDelta(e.deltaX, e.deltaMode), -panDelta(e.deltaY, e.deltaMode)),
        )
        showDrawn()
      }
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [rig, kick, showDrawn])

  // -----------------------------------------------------------------------
  // Click handlers
  // -----------------------------------------------------------------------

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isBackground(e.target as HTMLElement, viewportRef.current)) return
      onStopEditing()
      selectNote(null)
      onSelectTree(null)
    },
    [onStopEditing, selectNote, onSelectTree],
  )

  // -----------------------------------------------------------------------
  // Right-click on the space itself: Ask Claude… (D-19). Cards and notes
  // open their own menu, carrying what was clicked.
  // -----------------------------------------------------------------------

  const openContextMenu = useContextMenu()
  const { openChat, panelOpen } = useContext(ChatContext)

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isBackground(e.target as HTMLElement, viewportRef.current)) return
      const world = pointerWorld(e.clientX, e.clientY)
      const tree = world ? treeAt(world.x, world.y) : null
      const items: Array<{ label: string; run: () => void }> = [
        {
          label: 'Ask Claude…',
          // Inside a workspace, the new chat goes at the pointer (frame-local).
          run: () =>
            void openChat(
              tree && world && tree.kind === 'workspace'
                ? { treeId: tree.id, at: { x: world.x - tree.frame.x, y: world.y - tree.frame.y } }
                : {},
            ),
        },
      ]
      if (onStartThread) {
        items.push({
          label: 'Start a thread',
          run: () =>
            onStartThread(
              tree && world
                ? { treeId: tree.id, x: world.x - tree.frame.x, y: world.y - tree.frame.y }
                : { treeId: null, x: 0, y: 0 },
            ),
        })
      }
      openContextMenu(e, items)
    },
    [pointerWorld, treeAt, openContextMenu, openChat, onStartThread],
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isBackground(e.target as HTMLElement, viewportRef.current)) return

      const world = pointerWorld(e.clientX, e.clientY)
      if (!world) return

      // With no tree open, the carried flow still applies: the app asks where
      // to save, creates a world, and puts the first note at its origin.
      if (trees.length === 0) {
        onCanvasDoubleClick({ treeId: null, x: 0, y: 0 })
        return
      }

      // A note must belong to a tree, so a double-click outside every frame
      // creates nothing (UA-06) rather than making an orphan.
      const tree = treeAt(world.x, world.y)
      if (!tree) return

      onCanvasDoubleClick({
        treeId: tree.id,
        x: world.x - tree.frame.x,
        y: world.y - tree.frame.y,
      })
    },
    [trees, treeAt, pointerWorld, onCanvasDoubleClick],
  )

  // -----------------------------------------------------------------------
  // Connection creation
  // -----------------------------------------------------------------------

  const handleStartConnection = useCallback((ref: NodeRef) => {
    setConnectingFrom(ref)
  }, [])

  const handleNoteHoverDuringConnection = useCallback(
    (ref: NodeRef | null) => {
      if (!connectingFrom) return
      const same = ref && nodeKey(ref) === nodeKey(connectingFrom)
      setConnectingHover(ref && !same ? ref : null)
    },
    [connectingFrom],
  )

  // -----------------------------------------------------------------------
  // Border select (D-08)
  // -----------------------------------------------------------------------

  const handleBorderSelect = useCallback(
    (ref: NodeRef) => {
      if (extendRef.current) {
        toggleNote(ref)
      } else {
        const only = selectedRefs.length === 1 && nodeKey(selectedRefs[0]) === nodeKey(ref)
        selectNote(only ? null : ref)
      }
      onStopEditing()
    },
    [selectedRefs, selectNote, toggleNote, onStopEditing],
  )

  // Typing into a note ends the selection, so one note is never blue for
  // being selected while another is blue for being edited. A modified click
  // on a note's text adds it to the selection instead of editing it.
  const handleStartEditing = useCallback(
    (ref: NodeRef) => {
      if (extendRef.current) {
        toggleNote(ref)
        return
      }
      if (selectedRefsRef.current.length > 0) selectNote(null)
      onStartEditing(ref)
    },
    [onStartEditing, selectNote, toggleNote],
  )

  const handleHover = useCallback((ref: NodeRef, hovered: boolean) => {
    setHoveredRef((prev) => {
      if (hovered) return ref
      return prev && nodeKey(prev) === nodeKey(ref) ? null : prev
    })
  }, [])

  // -----------------------------------------------------------------------
  // Keyboard Delete/Backspace: delete the selected note (D-21).
  // The Delete key does nothing to frames (UI-SPEC).
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (selectedRefs.length === 0) return
      if (editingRef) return
      if (isTypingTarget(e.target)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        for (const ref of selectedRefs) onDeleteNote(ref)
        selectNote(null)
      } else if (e.key === 'Escape') {
        selectNote(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedRefs, editingRef, onDeleteNote, selectNote])

  // -----------------------------------------------------------------------
  // Keyboard roll: Q and E turn the canvas, 0 levels it, about the centre.
  // Never while typing, and never with Cmd, Ctrl or Alt held (Cmd+Q and
  // Cmd+0 belong to the app menu).
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (editingRef) return
      if (isTypingTarget(e.target)) return
      const viewport = viewportRef.current
      if (!viewport) return

      const cx = viewport.clientWidth / 2
      const cy = viewport.clientHeight / 2
      const key = e.key.toLowerCase()
      if (key === 'q') rig.roll(-ROLL_KEY_STEP_DEG, cx, cy, performance.now())
      else if (key === 'e') rig.roll(ROLL_KEY_STEP_DEG, cx, cy, performance.now())
      else if (key === '0') rig.resetRoll(cx, cy)
      else return
      e.preventDefault()
      kick()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingRef, rig, kick])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const containerStyle: React.CSSProperties = {
    transform: cameraTransformCss(view),
    transformOrigin: '0 0',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  }

  /** Settle the space around a tree once `commit` has landed. */
  const settleAfter = (treeId: string, commit: void | Promise<void>): void => {
    void Promise.resolve(commit)
      .catch(() => undefined)
      .then(() => requestSettle(treeId))
  }

  const handlers: TreeFrameHandlers = {
    onStartEditing: handleStartEditing,
    onSave,
    onMarkDirty,
    onMarkClean,
    // A note landing or resizing can grow its frame into a neighbour, so the
    // space re-settles on the same rule a frame drag uses.
    // It settles once the commit is back and the frame has been measured
    // with the note where it landed; settling at once would measure the
    // frame as it was before the drop and push nothing aside.
    onPositionChange: (ref, x, y) => settleAfter(ref.treeId, onPositionChange(ref, x, y)),
    onTakeOverPosition: (ref, x, y) => settleAfter(ref.treeId, onTakeOverPosition(ref, x, y)),
    onWidthChange: (ref, width) => settleAfter(ref.treeId, onWidthChange(ref, width)),
    onHeightChange: (ref, height) => settleAfter(ref.treeId, onHeightChange(ref, height)),
    onPinnedPositionChange,
    onDeleteNote,
    onPropertyEdit,
    onBorderSelect: handleBorderSelect,
    onHover: handleHover,
    onHoverDuringConnection: handleNoteHoverDuringConnection,
    onStartConnection: handleStartConnection,
    onRegisterDims: registerNodeDims,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onCloseTree,
    // D-21: expanding a folder can grow the workspace frame into a neighbour.
    onToggleFolder: (folderRef, collapsed) => {
      void onToggleFolder(folderRef.treeId, folderRef.nodeId, collapsed, dimsOfTree(folderRef.treeId))
        .then(() => requestSettle(folderRef.treeId))
        .catch(() => undefined)
    },
    onNestingMove: (noteRef, ops) => settleAfter(noteRef.treeId, onNestingMove(noteRef, ops)),
    onCreateInside: (container, x, y) => {
      onCreateInside(container, x, y)
      recordFrameGrowth(container.treeId)
    },
    onZoomToRect: (treeId, rect, onFlight) => zoomToFrameRect(treeId, rect, onFlight),
    onFolderHeaderPointerDown: (folderRef, e) => {
      if (e.button !== 0) return
      // A folder header is not canvas background: dragging it must not pan.
      e.stopPropagation()
      e.preventDefault()
      const tree = trees.find((t) => t.id === folderRef.treeId)
      const node = tree?.nodes.find((n) => n.id === folderRef.nodeId)
      if (!node) return
      const live = dragPositions[nodeKey(folderRef)]
      folderDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: live ? live.x : Number(node.props['position.x']?.value ?? 0),
        originY: live ? live.y : Number(node.props['position.y']?.value ?? 0),
        moved: false,
      }
      setDraggingFolder(folderRef)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
  }

  // Stable stand-ins for what each frame is handed, so a frame is re-rendered
  // only when something of its own changed. The handlers object and the frame
  // callbacks delegate to this render's versions, so none of them goes stale.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const [stableHandlers] = useState(() => {
    const cache = new Map<string, unknown>()
    return new Proxy({} as TreeFrameHandlers, {
      get: (_target, name: string) => {
        if (!cache.has(name)) {
          cache.set(name, (...args: unknown[]) =>
            (handlersRef.current[name as keyof TreeFrameHandlers] as (...a: unknown[]) => unknown)(...args),
          )
        }
        return cache.get(name)
      },
    })
  })
  const frameHeaderDownRef = useRef(handleFrameHeaderPointerDown)
  frameHeaderDownRef.current = handleFrameHeaderPointerDown
  const frameCallbacksRef = useRef(
    new Map<
      string,
      {
        onHeaderPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
        onFrameHover: (hovered: boolean) => void
      }
    >(),
  )
  const frameCallbacksOf = (treeId: string) => {
    let callbacks = frameCallbacksRef.current.get(treeId)
    if (!callbacks) {
      callbacks = {
        onHeaderPointerDown: (e) => frameHeaderDownRef.current(treeId, e),
        onFrameHover: (hovered) => setHoveredTreeId(hovered ? treeId : null),
      }
      frameCallbacksRef.current.set(treeId, callbacks)
    }
    return callbacks
  }
  const selectedKeysOf = (treeId: string): ReadonlySet<string> => {
    const keys = selectedRefs.filter((r) => r.treeId === treeId).map(nodeKey)
    return slice(`sel:${treeId}`, keys.join(','), () => new Set(keys))
  }
  const positionsOf = (
    kind: string,
    all: Record<string, Point>,
    treeId: string,
  ): Record<string, Point> => {
    const prefix = `${treeId}|`
    const mine = Object.entries(all).filter(([key]) => key.startsWith(prefix))
    return slice(`${kind}:${treeId}`, JSON.stringify(mine), () => Object.fromEntries(mine))
  }

  // -----------------------------------------------------------------------
  // Edge arrows (02.8 D-16): session cards waiting off-screen. The arrow
  // layer draws them; only its click, the person's own action, pans here.
  // -----------------------------------------------------------------------

  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 })
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return undefined
    const read = (): void => {
      const width = el.clientWidth
      const height = el.clientHeight
      setViewportSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    }
    read()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Every session card of every open tree, in world coordinates: the frame's
  // origin plus the note's drawn spot, at its measured size. A session nested
  // inside another note is drawn in that note's coordinates and is left out.
  const sessionCards: EdgeArrowSessionCard[] = []
  for (const tree of trees) {
    if (!tree.nodes.some(isSessionNode)) continue
    const nesting = buildNesting(tree.nodes)
    const spots = treeSpots.get(tree.id)
    for (const node of tree.nodes) {
      if (!isSessionNode(node) || isNested(nesting, node.id)) continue
      const spot = spots?.get(node.id)
      const localX = spot ? spot.x : Number(node.props['position.x']?.value ?? 0)
      const localY = spot ? spot.y : Number(node.props['position.y']?.value ?? 0)
      const dims = nodeDimsRef.current.get(nodeKey({ treeId: tree.id, nodeId: node.id }))
      const rawTitle = node.props['title']?.value
      const title = typeof rawTitle === 'string' && rawTitle.trim().length > 0 ? rawTitle : NEW_SESSION_TITLE
      sessionCards.push({
        key: chatSessionKey(tree.id, node.id),
        treeId: tree.id,
        noteId: node.id,
        worldRect: {
          x: tree.frame.x + localX,
          y: tree.frame.y + localY,
          width: dims?.width ?? SESSION_WIDTH,
          height: dims?.height ?? SESSION_HEIGHT,
        },
        title,
      })
    }
  }
  // Kept by identity until a card moves, resizes or is renamed.
  const sessionCardsSig = JSON.stringify(sessionCards)
  const sessionCardsRef = useRef<{ sig: string; cards: EdgeArrowSessionCard[] }>({ sig: '', cards: [] })
  if (sessionCardsRef.current.sig !== sessionCardsSig) {
    sessionCardsRef.current = { sig: sessionCardsSig, cards: sessionCards }
  }
  const stableSessionCards = sessionCardsRef.current.cards
  const panelOpenRef = useRef(panelOpen)
  panelOpenRef.current = panelOpen

  /**
   * Centre a session card in the visible area (left of the panel when it is
   * open) at the current zoom and roll: the CameraRig glide panToFrame uses,
   * or a jump under reduced motion. Only an edge arrow's click calls this; no
   * status, event or store change ever moves the camera (D-16).
   */
  const panToSession = useCallback(
    (treeId: string, noteId: string) => {
      const viewport = viewportRef.current
      const key = chatSessionKey(treeId, noteId)
      const card = sessionCardsRef.current.cards.find((c) => c.key === key)
      if (!viewport || !card) return
      const { clientWidth, clientHeight } = viewport
      const visibleWidth = Math.max(0, clientWidth - (panelOpenRef.current ? PANEL_COLUMN : 0))
      const cx = card.worldRect.x + card.worldRect.width / 2
      const cy = card.worldRect.y + card.worldRect.height / 2
      const reduced =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) {
        rig.direct((c) => centerOn(c, cx, cy, visibleWidth, clientHeight))
        showDrawn()
        return
      }
      rig.easeTo((c) => centerOn(c, cx, cy, visibleWidth, clientHeight), FLY_TAU_MS)
      kick()
    },
    [rig, kick, showDrawn],
  )

  // The in-progress connection line is drawn in world space, above the frames,
  // so it stays visible while the pointer is between two of them.
  let tempConnectionLine: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (connectingFrom && connectingLine) {
    const tree = trees.find((t) => t.id === connectingFrom.treeId)
    const node = tree?.nodes.find((n) => n.id === connectingFrom.nodeId)
    if (tree && node) {
      const key = nodeKey(connectingFrom)
      const drag = dragPositions[key]
      const spot = treeSpots.get(tree.id)?.get(node.id)
      const dims = nodeDimsRef.current.get(key)
      const localX = spot ? spot.x : drag ? drag.x : Number(node.props['position.x']?.value ?? 0)
      const localY = spot ? spot.y : drag ? drag.y : Number(node.props['position.y']?.value ?? 0)
      tempConnectionLine = {
        x1: tree.frame.x + localX + (dims?.width ?? DEFAULT_NODE_WIDTH) / 2,
        y1: tree.frame.y + localY + (dims?.height ?? DEFAULT_NODE_HEIGHT) / 2,
        x2: connectingLine.x,
        y2: connectingLine.y,
      }
    }
  }

  return (
    <div
      ref={viewportRef}
      className="tapestry-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Empty state (UI-SPEC copywriting) */}
      {trees.length === 0 && (
        <div className="tapestry-empty-state">
          <h2 className="tapestry-empty-heading">Double-click anywhere to start</h2>
          <p className="tapestry-empty-body">{EMPTY_BODY}</p>
        </div>
      )}

      <SelectionBar
        selected={selectedRefs}
        trees={trees}
        onGoTo={(ref) => panToNote(ref.treeId, ref.nodeId)}
        onDeselect={toggleNote}
        onClear={() => selectNote(null)}
      />

      {/* Transformed container: every frame pans and zooms together */}
      <div className="tapestry-canvas-container" style={containerStyle}>
        {trees.map((tree) => {
          const rect = frameRects.get(tree.id)
          if (!rect) return null
          return (
            <TreeFrame
              key={tree.id}
              tree={tree}
              rect={rect}
              zoom={view.zoom}
              roll={view.roll}
              editingKey={editingRef?.treeId === tree.id ? nodeKey(editingRef) : null}
              hoveredKey={hoveredRef?.treeId === tree.id ? nodeKey(hoveredRef) : null}
              selectedKeys={selectedKeysOf(tree.id)}
              connectingHoverKey={
                connectingHover?.treeId === tree.id ? nodeKey(connectingHover) : null
              }
              isConnecting={connectingFrom !== null}
              landedAt={landed?.treeId === tree.id ? landed.at : null}
              pluginNodeViews={pluginNodeViews}
              currentUserActorId={currentUserActorId}
              dragPositions={positionsOf('drag', dragPositions, tree.id)}
              followerPositions={positionsOf('follow', followerPositions, tree.id)}
              displayPositions={treeSpots.get(tree.id) ?? NO_DISPLAY_SPOTS}
              getDims={getDims}
              isSelected={selectedTreeId === tree.id}
              isHovered={hoveredTreeId === tree.id}
              isDragging={draggingTreeId === tree.id}
              onHeaderPointerDown={frameCallbacksOf(tree.id).onHeaderPointerDown}
              onFrameHover={frameCallbacksOf(tree.id).onFrameHover}
              handlers={stableHandlers}
              subspaces={treeSubspaces.get(tree.id)}
              openRequest={openRequest?.key.startsWith(`${tree.id}:`) ? openRequest : null}
            />
          )
        })}

        {/* Temporary connection line during drag-connect */}
        {tempConnectionLine && (
          <svg
            className="tapestry-connections-svg"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              // 1 px, not 100%: the parent has no size, and a 0 × 0 SVG draws nothing
              // even with overflow visible.
              width: 1,
              height: 1,
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          >
            <ConnectionLine
              x1={tempConnectionLine.x1}
              y1={tempConnectionLine.y1}
              x2={tempConnectionLine.x2}
              y2={tempConnectionLine.y2}
              isTemporary
            />
          </svg>
        )}
      </div>

      {/* Edge arrows: screen space, outside the transform, after the canvas
          and before the ChatPanel in DOM order (02.8 D-16). */}
      <EdgeArrowLayer
        cards={stableSessionCards}
        camera={view}
        viewport={viewportSize}
        panelOpen={panelOpen}
        onGo={panToSession}
      />
    </div>
  )
}

export default forwardRef(Canvas)
