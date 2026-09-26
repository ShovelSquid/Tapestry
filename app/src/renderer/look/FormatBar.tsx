/**
 * `<FormatBar>`: a note's top-right buttons and its format pill (Line Lab
 * v2, Part 2 wave 3). Replaces FloatingToolbar. `format-bar.ts` holds the
 * model: which icons, what each one does, when the pill opens, where
 * everything sits.
 *
 * - A blue note (selected or editing) shows two pencil circles in its
 *   top-right corner: `f` and, to its right, the settings button, which
 *   flips the note to its settings (`NoteSettings.tsx`).
 * - While editing, a text selection or the pointer on the `f` opens the
 *   pill along the top edge: `f i b u ✱`. Resting on a section icon opens
 *   it in place; resting on `‹` goes back. Pressing works too, at once.
 * - The red dot's hover folds the pill back to the `f` (spec §4).
 *
 * Every control acts on pointer down and prevents default, so the editor
 * keeps its focus and its selection (D-07), as the old toolbar did.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import {
  getActiveBlockType,
  isMarkActive,
  setAlignment,
  setFontFamily,
  setHeading,
  setParagraph,
  setTextColor,
  toggleBold,
  toggleBulletList,
  toggleItalic,
  toggleOrderedList,
} from '../editor/toolbar-commands'
import { FONT_FAMILIES, TEXT_COLORS } from '../editor/schema'
import { circlePts, fillPath, inkShape, roundedRectPts } from './ink'
import { InkLine } from './InkLine'
import {
  BACK_GLYPH,
  back,
  barLayout,
  buildFormatTree,
  enter,
  itemsAt,
  pillOpen,
  type FormatCommand,
  type FormatItem,
  type FormatPath,
} from './format-bar'

/** Pencil weight for the small buttons (Line Lab: lw × 0.8). */
const BUTTON_WEIGHT = 0.8
/** How long the pointer rests on a section icon (or `‹`) before it opens. */
const DWELL_MS = 250
/** The pill stays open this long after the pointer leaves it (D-25). */
const CLOSE_MS = 300

const TREE = buildFormatTree(FONT_FAMILIES, TEXT_COLORS)

function runCommand(view: EditorView, c: FormatCommand): void {
  switch (c.kind) {
    case 'italic': return toggleItalic(view)
    case 'bold': return toggleBold(view)
    case 'font': return setFontFamily(view, c.family)
    case 'heading': return setHeading(view, c.level)
    case 'paragraph': return setParagraph(view)
    case 'bulletList': return toggleBulletList(view)
    case 'orderedList': return toggleOrderedList(view)
    case 'align': return setAlignment(view, c.align)
    case 'color': return setTextColor(view, c.color)
    // Gate 1: never reached, the buttons are disabled.
    case 'underline':
    case 'strikethrough':
      return
  }
}

function isActive(view: EditorView, item: FormatItem): boolean {
  const c = item.command
  if (!c) return false
  switch (c.kind) {
    case 'italic': return isMarkActive(view, 'em')
    case 'bold': return isMarkActive(view, 'strong')
    case 'heading': return getActiveBlockType(view) === `h${c.level}`
    case 'bulletList': return getActiveBlockType(view) === 'bullet'
    case 'orderedList': return getActiveBlockType(view) === 'ordered'
    default: return false
  }
}

/** Whether the editor has a non-empty text selection, kept current. */
export function useTextSelected(view: EditorView | null): boolean {
  const [selected, setSelected] = useState(false)
  useEffect(() => {
    if (!view) {
      setSelected(false)
      return
    }
    let disposed = false
    // Deferred so ProseMirror has read the DOM selection first.
    const update = (): void => {
      setTimeout(() => {
        if (disposed) return
        const sel = view.state.selection
        setSelected(!sel.empty && view.hasFocus())
      }, 10)
    }
    update()
    document.addEventListener('selectionchange', update)
    view.dom.addEventListener('mouseup', update)
    view.dom.addEventListener('keyup', update)
    return () => {
      disposed = true
      document.removeEventListener('selectionchange', update)
      view.dom.removeEventListener('mouseup', update)
      view.dom.removeEventListener('keyup', update)
    }
  }, [view])
  return selected
}

// ---------------------------------------------------------------------------
// The small pencil circles
// ---------------------------------------------------------------------------

interface CircleButtonProps {
  readonly cx: number
  readonly cy: number
  readonly r: number
  readonly seed: number
  readonly label: string
  readonly className: string
  readonly pressed?: boolean
  readonly onPress: () => void
  readonly onPointerEnter?: () => void
  readonly onPointerLeave?: () => void
  readonly children: React.ReactNode
}

function CircleButton({ cx, cy, r, seed, label, className, pressed, onPress, onPointerEnter, onPointerLeave, children }: CircleButtonProps): React.ReactElement {
  const shape = useMemo(() => inkShape(circlePts(r, r, r), true, seed, { step: 1.5, wobbleScale: 0.35 }), [r, seed])
  const fill = useMemo(() => fillPath(shape), [shape])
  return (
    <button
      className={`tapestry-format-circle ${className}`}
      style={{ left: cx - r, top: cy - r, width: r * 2, height: r * 2 }}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      tabIndex={-1}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onPress()
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <svg className="tapestry-format-paper" aria-hidden="true">
        <path d={fill} />
      </svg>
      <InkLine shape={shape} seed={seed} weight={BUTTON_WEIGHT} />
      <span className="tapestry-format-circle-glyph">{children}</span>
    </button>
  )
}

/** The settings glyph: Line Lab's six short spokes. */
function Spokes(): React.ReactElement {
  const spokes = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    spokes.push(
      <line key={i} x1={Math.cos(a) * 3.5} y1={Math.sin(a) * 3.5} x2={Math.cos(a) * 7} y2={Math.sin(a) * 7} />,
    )
  }
  return (
    <svg className="tapestry-format-spokes" viewBox="-8 -8 16 16" aria-hidden="true">
      {spokes}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// The pill
// ---------------------------------------------------------------------------

export interface FormatPillProps {
  readonly view: EditorView
  readonly seed: number
  /** Top-left and smallest width, in the owner's px. */
  readonly x: number
  readonly y: number
  readonly minW: number
  readonly h: number
  readonly onPointerEnter?: () => void
  readonly onPointerLeave?: () => void
}

function FormatPillImpl({ view, seed, x, y, minW, h, onPointerEnter, onPointerLeave }: FormatPillProps): React.ReactElement {
  const [path, setPath] = useState<FormatPath>([])
  const items = itemsAt(TREE, path)
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearDwell = (): void => {
    if (dwell.current) clearTimeout(dwell.current)
    dwell.current = null
  }
  useEffect(() => clearDwell, [])

  // Active marks are read from view.state during render; bump after every
  // command so they re-render (the pointer-down never reaches view.dom).
  const [, bump] = useReducer((n: number) => n + 1, 0)

  // The pill fits its icons; the outline is rebuilt only when its size changes.
  const boxRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(minW)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const next = Math.max(minW, el.offsetWidth)
    setW((cur) => (cur === next ? cur : next))
  })
  const shape = useMemo(() => {
    const r = h / 2
    return inkShape(roundedRectPts(w, h, [r, r, r, r]), true, seed + 6, { step: 2, wobbleScale: 0.35 })
  }, [w, h, seed])
  const fill = useMemo(() => fillPath(shape), [shape])

  const press = useCallback(
    (item: FormatItem) => {
      clearDwell()
      if (item.disabled) return
      if (item.children) {
        setPath((p) => enter(TREE, p, item.id))
        return
      }
      if (item.command) {
        runCommand(view, item.command)
        bump()
      }
    },
    [view],
  )

  const rest = (fn: () => void): void => {
    clearDwell()
    dwell.current = setTimeout(() => {
      dwell.current = null
      fn()
    }, DWELL_MS)
  }

  const inSection = path.length > 0
  return (
    <div
      className="tapestry-format-pill"
      style={{ left: x, top: y, height: h, minWidth: minW }}
      ref={boxRef}
      role="toolbar"
      aria-label="Formatting"
      onPointerEnter={onPointerEnter}
      onPointerLeave={() => {
        clearDwell()
        onPointerLeave?.()
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
      }}
    >
      <svg className="tapestry-format-paper" aria-hidden="true">
        <path d={fill} />
      </svg>
      <InkLine shape={shape} seed={seed + 6} weight={BUTTON_WEIGHT} />
      {items.map((item) => (
        <button
          key={item.id}
          className={
            'tapestry-format-icon' +
            (item.children ? ' tapestry-format-icon--section' : '') +
            (isActive(view, item) ? ' active' : '') +
            (item.glyph.length > 2 ? ' tapestry-format-icon--word' : '')
          }
          data-glyph={item.glyph}
          style={item.swatch ? undefined : item.command?.kind === 'font' && item.command.family ? { fontFamily: item.command.family } : undefined}
          title={item.label}
          aria-label={item.label}
          disabled={item.disabled}
          tabIndex={-1}
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            press(item)
          }}
          onPointerEnter={() => {
            if (item.children && !item.disabled) rest(() => setPath((p) => enter(TREE, p, item.id)))
          }}
          onPointerLeave={clearDwell}
        >
          {item.swatch ? <span className="tapestry-format-swatch" style={{ backgroundColor: item.swatch }} /> : item.glyph}
        </button>
      ))}
      {inSection && (
        <button
          className="tapestry-format-icon tapestry-format-icon--back"
          title="Back"
          aria-label="Back"
          tabIndex={-1}
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            clearDwell()
            setPath(back)
          }}
          onPointerEnter={() => rest(() => setPath(back))}
          onPointerLeave={clearDwell}
        >
          {BACK_GLYPH}
        </button>
      )}
    </div>
  )
}

export const FormatPill = memo(FormatPillImpl)

// ---------------------------------------------------------------------------
// The note's bar
// ---------------------------------------------------------------------------

export interface FormatBarProps {
  readonly view: EditorView | null
  /** The card's layout width, in its own px. */
  readonly w: number
  readonly seed: number
  readonly editing: boolean
  readonly redHover: boolean
  readonly settingsOpen: boolean
  readonly onToggleSettings: () => void
  /** Pressing `f` on a note that isn't being edited starts editing it. */
  readonly onStartEditing: () => void
}

function FormatBarImpl({ view, w, seed, editing, redHover, settingsOpen, onToggleSettings, onStartEditing }: FormatBarProps): React.ReactElement | null {
  const textSelected = useTextSelected(editing ? view : null)
  const [pointerOnBar, setPointerOnBar] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerIn = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setPointerOnBar(true)
  }, [])
  const pointerOut = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setPointerOnBar(false)
    }, CLOSE_MS)
  }, [])
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const layout = barLayout(w)
  const open = !settingsOpen && view !== null && pillOpen({ editing, textSelected, pointerOnBar, redHover })

  return (
    <div className="tapestry-format-bar">
      {open && view ? (
        <>
        {/* Where the `f` was: the pointer resting there keeps the pill open,
            and leaving it closes the pill like leaving the pill does. */}
        <div
          className="tapestry-format-f-anchor"
          style={{ left: layout.f.x - layout.f.r, top: layout.f.y - layout.f.r, width: layout.f.r * 2, height: layout.f.r * 2 }}
          onPointerEnter={pointerIn}
          onPointerLeave={pointerOut}
        />
        <FormatPill
          view={view}
          seed={seed}
          x={layout.pill.x}
          y={layout.pill.y}
          minW={layout.pill.w}
          h={layout.pill.h}
          onPointerEnter={pointerIn}
          onPointerLeave={pointerOut}
        />
        </>
      ) : (
        !settingsOpen && (
          <CircleButton
            cx={layout.f.x}
            cy={layout.f.y}
            r={layout.f.r}
            seed={seed + 3}
            label="Format"
            className="tapestry-format-circle--f"
            onPress={() => {
              if (!editing) onStartEditing()
              pointerIn()
            }}
            onPointerEnter={pointerIn}
            onPointerLeave={pointerOut}
          >
            f
          </CircleButton>
        )
      )}
      <CircleButton
        cx={layout.settings.x}
        cy={layout.settings.y}
        r={layout.settings.r}
        seed={seed + 4}
        label={settingsOpen ? 'Back to the note' : 'Note settings'}
        className="tapestry-format-circle--settings"
        pressed={settingsOpen}
        onPress={onToggleSettings}
      >
        <Spokes />
      </CircleButton>
    </div>
  )
}

export const FormatBar = memo(FormatBarImpl)
