/**
 * FloatingToolbar — compact formatting toolbar near selected text (D-24).
 *
 * Hover-expand submenus stay open while pointer is inside, collapse after
 * 300ms delay on leaving (D-25). Works identically in NoteCard and
 * ThreadCenterNode editors (D-26).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
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

const TEXT_COLORS = [
  { label: 'Default', color: '#2C2C2C' },
  { label: 'Red', color: '#E5484D' },
  { label: 'Orange', color: '#E76F00' },
  { label: 'Green', color: '#2D8A4E' },
  { label: 'Blue', color: '#4A7CFF' },
  { label: 'Purple', color: '#7C3AED' },
  { label: 'Light Gray', color: '#B0ADA6' },
  { label: 'Dark Gray', color: '#6B6B6B' },
]

const FONT_FAMILIES = [
  { label: 'System', family: '' },
  { label: 'Serif', family: 'Georgia, serif' },
  { label: 'Mono', family: "'SF Mono', 'Fira Code', monospace" },
]

const ALIGNMENTS = [
  { label: 'Left', value: null },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
]

interface FloatingToolbarProps {
  view: EditorView | null
  containerRef: React.RefObject<HTMLElement | null>
}

export default function FloatingToolbar({
  view,
  containerRef,
}: FloatingToolbarProps): React.ReactElement | null {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const submenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

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

    const update = () => {
      const { from, to, empty } = view.state.selection
      if (empty) { setVisible(false); return }

      const start = view.coordsAtPos(from)
      const end = view.coordsAtPos(to)
      const container = containerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      setPosition({
        top: start.top - containerRect.top - 44,
        left: (start.left + end.left) / 2 - containerRect.left,
      })
      setVisible(true)
    }

    const plugin = view.dom.addEventListener('mouseup', () => setTimeout(update, 10))
    const keyup = view.dom.addEventListener('keyup', () => setTimeout(update, 10))

    return () => {
      view.dom.removeEventListener('mouseup', update)
      view.dom.removeEventListener('keyup', update)
    }
  }, [view, containerRef])

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
        onMouseDown={(e) => { e.preventDefault(); toggleBold(view) }}
        title="Bold"
      >
        <strong>B</strong>
      </button>
      <button
        className={`ft-btn ${italicActive ? 'active' : ''}`}
        onMouseDown={(e) => { e.preventDefault(); toggleItalic(view) }}
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
              onMouseDown={(e) => { e.preventDefault(); setHeading(view, 1) }}>H1</button>
            <button className={`ft-sub-btn ${blockType === 'h2' ? 'active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); setHeading(view, 2) }}>H2</button>
            <button className={`ft-sub-btn ${blockType === 'h3' ? 'active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); setHeading(view, 3) }}>H3</button>
            <button className="ft-sub-btn"
              onMouseDown={(e) => { e.preventDefault(); setParagraph(view) }}>¶</button>
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
              onMouseDown={(e) => { e.preventDefault(); toggleBulletList(view) }}>• List</button>
            <button className={`ft-sub-btn ${blockType === 'ordered' ? 'active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); toggleOrderedList(view) }}>1. List</button>
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
                onMouseDown={(e) => { e.preventDefault(); setTextColor(view, c.color) }}
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
                onMouseDown={(e) => { e.preventDefault(); setAlignment(view, a.value) }}>
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
                onMouseDown={(e) => { e.preventDefault(); setFontFamily(view, f.family) }}>
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
