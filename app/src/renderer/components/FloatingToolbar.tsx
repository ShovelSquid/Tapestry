/**
 * FloatingToolbar — compact formatting toolbar near selected text (D-24).
 *
 * Hover-expand submenus stay open while pointer is inside, collapse after
 * 300ms delay on leaving (D-25). Works identically in NoteCard and
 * KnotNode editors (D-26).
 */

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import {
  toggleBold,
  toggleItalic,
  setHeading,
  setParagraph,
  toggleBulletList,
  toggleOrderedList,
  setTextColor,
  setFontFamily,
  setAlignment,
  isMarkActive,
  getActiveBlockType,
} from '../editor/toolbar-commands'
import { TEXT_COLORS, FONT_FAMILIES } from '../editor/schema'
import { screenToElementLocal } from '../layout/camera'

const ALIGNMENTS = [
  { label: 'Left', value: null },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
]

/** Vertical gap (in container-local px) between the selection top and the toolbar. */
const TOOLBAR_OFFSET = 44

interface FloatingToolbarProps {
  view: EditorView | null
  containerRef: React.RefObject<HTMLElement | null>
  /**
   * Canvas zoom and roll (degrees) of the ancestor
   * `rotate(roll) scale(zoom)` container. Screen (getBoundingClientRect)
   * points must be un-rotated and divided by the zoom to become local offsets
   * for `position: absolute` inside the card. Roll defaults to 0.
   */
  zoom?: number
  roll?: number
}

export default function FloatingToolbar({
  view,
  containerRef,
  zoom = 1,
  roll = 0,
}: FloatingToolbarProps): React.ReactElement | null {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  // Active-state indicators (bold/italic/block type) are read from view.state
  // during render. Toolbar buttons use onMouseDown+preventDefault, so the
  // following mouseup lands on the button, not view.dom, and no selection
  // listener fires. Bump a counter after every command to re-render.
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const run = useCallback((e: React.MouseEvent, command: () => void) => {
    e.preventDefault()
    command()
    bump()
  }, [])

  const clearSubmenuTimer = useCallback(() => {
    if (submenuTimerRef.current) {
      clearTimeout(submenuTimerRef.current)
      submenuTimerRef.current = null
    }
  }, [])

  const startSubmenuClose = useCallback(() => {
    clearSubmenuTimer()
    submenuTimerRef.current = setTimeout(() => {
      setOpenSubmenu(null)
    }, 300)
  }, [clearSubmenuTimer])

  useEffect(() => {
    if (!view) { setVisible(false); return }

    // Guards the deferred update() calls below against running after cleanup
    // (unmount or view change), when the EditorView may already be destroyed.
    let disposed = false

    const update = () => {
      if (disposed) return
      const { from, to, empty } = view.state.selection
      if (empty) { setVisible(false); return }

      const start = view.coordsAtPos(from)
      const end = view.coordsAtPos(to)
      const container = containerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const scale = zoom > 0 ? zoom : 1
      const local = screenToElementLocal(
        { x: (start.left + end.left) / 2, y: start.top },
        containerRect,
        { width: container.offsetWidth, height: container.offsetHeight },
        scale,
        roll,
      )
      setPosition({
        top: local.y - TOOLBAR_OFFSET,
        left: local.x,
      })
      setVisible(true)
    }

    // Defer slightly so the selection has settled before measuring it.
    const onMouseUp = () => setTimeout(update, 10)
    const onKeyUp = () => setTimeout(update, 10)
    view.dom.addEventListener('mouseup', onMouseUp)
    view.dom.addEventListener('keyup', onKeyUp)

    return () => {
      disposed = true
      view.dom.removeEventListener('mouseup', onMouseUp)
      view.dom.removeEventListener('keyup', onKeyUp)
    }
  }, [view, containerRef, zoom, roll])

  if (!visible || !view) return null

  const boldActive = isMarkActive(view, 'strong')
  const italicActive = isMarkActive(view, 'em')
  const blockType = getActiveBlockType(view)

  return (
    <div
      ref={toolbarRef}
      className="floating-toolbar"
      style={{ top: position.top, left: position.left }}
      onMouseLeave={startSubmenuClose}
      onMouseEnter={clearSubmenuTimer}
    >
      <button
        className={`ft-btn ${boldActive ? 'active' : ''}`}
        onMouseDown={(e) => run(e, () => toggleBold(view))}
        title="Bold"
      >
        <strong>B</strong>
      </button>
      <button
        className={`ft-btn ${italicActive ? 'active' : ''}`}
        onMouseDown={(e) => run(e, () => toggleItalic(view))}
        title="Italic"
      >
        <em>I</em>
      </button>

      <span className="ft-sep" />

      {/* Heading submenu */}
      <div
        className="ft-submenu-wrap"
        onMouseEnter={() => { clearSubmenuTimer(); setOpenSubmenu('heading') }}
        onMouseLeave={startSubmenuClose}
      >
        <button className={`ft-btn ${blockType.startsWith('h') ? 'active' : ''}`} title="Heading">
          H
        </button>
        {openSubmenu === 'heading' && (
          <div className="ft-submenu">
            <button className={`ft-sub-btn ${blockType === 'h1' ? 'active' : ''}`}
              onMouseDown={(e) => run(e, () => setHeading(view, 1))}>H1</button>
            <button className={`ft-sub-btn ${blockType === 'h2' ? 'active' : ''}`}
              onMouseDown={(e) => run(e, () => setHeading(view, 2))}>H2</button>
            <button className={`ft-sub-btn ${blockType === 'h3' ? 'active' : ''}`}
              onMouseDown={(e) => run(e, () => setHeading(view, 3))}>H3</button>
            <button className="ft-sub-btn"
              onMouseDown={(e) => run(e, () => setParagraph(view))}>¶</button>
          </div>
        )}
      </div>

      {/* List submenu */}
      <div
        className="ft-submenu-wrap"
        onMouseEnter={() => { clearSubmenuTimer(); setOpenSubmenu('list') }}
        onMouseLeave={startSubmenuClose}
      >
        <button className={`ft-btn ${blockType === 'bullet' || blockType === 'ordered' ? 'active' : ''}`} title="List">
          ≡
        </button>
        {openSubmenu === 'list' && (
          <div className="ft-submenu">
            <button className={`ft-sub-btn ${blockType === 'bullet' ? 'active' : ''}`}
              onMouseDown={(e) => run(e, () => toggleBulletList(view))}>• List</button>
            <button className={`ft-sub-btn ${blockType === 'ordered' ? 'active' : ''}`}
              onMouseDown={(e) => run(e, () => toggleOrderedList(view))}>1. List</button>
          </div>
        )}
      </div>

      <span className="ft-sep" />

      {/* Color submenu */}
      <div
        className="ft-submenu-wrap"
        onMouseEnter={() => { clearSubmenuTimer(); setOpenSubmenu('color') }}
        onMouseLeave={startSubmenuClose}
      >
        <button className="ft-btn" title="Text Color">
          <span style={{ color: '#E5484D' }}>A</span>
        </button>
        {openSubmenu === 'color' && (
          <div className="ft-submenu ft-color-grid">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.color}
                className="ft-color-swatch"
                style={{ backgroundColor: c.color }}
                title={c.label}
                onMouseDown={(e) => run(e, () => setTextColor(view, c.color))}
              />
            ))}
          </div>
        )}
      </div>

      {/* Alignment submenu */}
      <div
        className="ft-submenu-wrap"
        onMouseEnter={() => { clearSubmenuTimer(); setOpenSubmenu('align') }}
        onMouseLeave={startSubmenuClose}
      >
        <button className="ft-btn" title="Alignment">⫶</button>
        {openSubmenu === 'align' && (
          <div className="ft-submenu">
            {ALIGNMENTS.map((a) => (
              <button key={a.label} className="ft-sub-btn"
                onMouseDown={(e) => run(e, () => setAlignment(view, a.value))}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Font family submenu */}
      <div
        className="ft-submenu-wrap"
        onMouseEnter={() => { clearSubmenuTimer(); setOpenSubmenu('font') }}
        onMouseLeave={startSubmenuClose}
      >
        <button className="ft-btn" title="Font">Aa</button>
        {openSubmenu === 'font' && (
          <div className="ft-submenu">
            {FONT_FAMILIES.map((f) => (
              <button key={f.label} className="ft-sub-btn"
                style={{ fontFamily: f.family || 'inherit' }}
                onMouseDown={(e) => run(e, () => setFontFamily(view, f.family))}>
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
