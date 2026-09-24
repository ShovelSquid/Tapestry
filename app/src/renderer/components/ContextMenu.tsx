/**
 * ContextMenu — the app's one right-click menu (02.7 D-19).
 *
 * The renderer had no context menu, so this is a small shared one: a provider
 * rendered once in App, a hook any component uses to open it at the pointer,
 * and the chat button cards and notes carry. **Ask Claude…** is its only item
 * for now; later items join the same list.
 *
 * The menu is a `role="menu"` list fixed at the pointer and kept inside the
 * window. The first item takes focus; ArrowUp/ArrowDown move, Enter runs.
 * Escape, a press outside, a wheel turn or the window losing focus close it,
 * and focus goes back where it was.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

export interface ContextMenuItem {
  label: string
  run: () => void
}

type OpenContextMenu = (event: React.MouseEvent, items: ContextMenuItem[]) => void

const ContextMenuContext = createContext<OpenContextMenu>(() => undefined)

interface MenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

/** Keep this far from the window's edges. */
const EDGE_MARGIN = 8

export function ContextMenuProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const open = useCallback<OpenContextMenu>((event, items) => {
    event.preventDefault()
    event.stopPropagation()
    if (items.length === 0) return
    const active = document.activeElement
    returnFocusRef.current = active instanceof HTMLElement ? active : null
    setPosition(null)
    setMenu({ x: event.clientX, y: event.clientY, items })
  }, [])

  const close = useCallback((returnFocus: boolean) => {
    setMenu(null)
    setPosition(null)
    if (returnFocus) returnFocusRef.current?.focus?.()
    returnFocusRef.current = null
  }, [])

  // Place the menu at the pointer, clamped so all of it stays on screen.
  useLayoutEffect(() => {
    if (!menu) return
    const element = menuRef.current
    const width = element?.offsetWidth ?? 0
    const height = element?.offsetHeight ?? 0
    const left = Math.max(EDGE_MARGIN, Math.min(menu.x, window.innerWidth - width - EDGE_MARGIN))
    const top = Math.max(EDGE_MARGIN, Math.min(menu.y, window.innerHeight - height - EDGE_MARGIN))
    setPosition({ left, top })
  }, [menu])

  useEffect(() => {
    if (menu && position) itemRefs.current[0]?.focus()
  }, [menu, position])

  useEffect(() => {
    if (!menu) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return
      close(false)
    }
    const onWheel = (): void => close(false)
    const onBlur = (): void => close(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('wheel', onWheel, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [menu, close])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // Keys pressed in the menu belong to the menu, never to the canvas.
    event.stopPropagation()
    if (!menu) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      close(true)
      return
    }
    const count = menu.items.length
    const current = itemRefs.current.findIndex((element) => element === document.activeElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const from = current === -1 ? 0 : current
      const next = event.key === 'ArrowDown' ? (from + 1) % count : (from - 1 + count) % count
      itemRefs.current[next]?.focus()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const item = menu.items[current === -1 ? 0 : current]
      close(false)
      item?.run()
    }
  }

  return (
    <ContextMenuContext.Provider value={open}>
      {children}
      {menu && (
        <div
          ref={menuRef}
          className="tapestry-menu tapestry-context-menu"
          role="menu"
          aria-label="Actions"
          style={{
            position: 'fixed',
            left: position?.left ?? menu.x,
            top: position?.top ?? menu.y,
            visibility: position ? 'visible' : 'hidden',
          }}
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {menu.items.map((item, index) => (
            <button
              key={item.label}
              ref={(element) => {
                itemRefs.current[index] = element
              }}
              type="button"
              role="menuitem"
              className="tapestry-menu-item"
              onClick={(event) => {
                event.stopPropagation()
                close(false)
                item.run()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </ContextMenuContext.Provider>
  )
}

/** Open the app's context menu at a mouse event with these items. */
export function useContextMenu(): OpenContextMenu {
  return useContext(ContextMenuContext)
}

/** Speech-bubble glyph. The button's label carries the meaning. */
function ChatGlyph(): React.ReactElement {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11.5H2.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The small chat button on file cards and notes. It stops the press that
 * starts a card drag, so clicking it never moves the card.
 */
export function AskClaudeButton({
  label,
  onAsk,
}: {
  label: string
  onAsk: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      className="tapestry-ask-claude-button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onAsk()
      }}
    >
      <ChatGlyph />
    </button>
  )
}
