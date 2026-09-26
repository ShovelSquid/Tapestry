/**
 * FrameHeader — the 64px band at the top of a tree's frame (UI-SPEC).
 *
 * Two rows: the tree's name with its Tree options button, and beneath them
 * what kind of tree it is followed by its own status. The status lives here
 * rather than in one corner of the window because the space holds several
 * trees at once: a single indicator would have to average them, and "Saved"
 * while another tree is still writing is exactly the reassurance D-02 forbids.
 *
 * The header is also the frame's drag handle. Pointer events that started on a
 * button or inside the open menu are left alone, so Tree options can be used
 * without dragging the frame out from under the pointer.
 *
 * A workspace folder's frame uses the same header (02.7 D-21), variant
 * 'folder': the same two rows and styles, with the folder's name and a
 * Collapse folder / Expand folder button in row 1, and "Folder · <n> files" in
 * row 2. It has no Tree options and no New chat.
 *
 * A workspace tree's status slot says whether its outside changes are being
 * recorded (02.7 D-06): "Watching", or in the destructive color why not.
 */

import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { TreeSaveState } from '../state/use-forest'
import { ChatContext } from '../state/chat'
import { useWorkspaceStatus, workspaceStatusLine } from '../state/workspace-status'

interface FrameHeaderProps {
  /** The tree this header belongs to; Tree options acts on it by id. */
  treeId: string
  name: string
  kind: 'native' | 'vault' | 'workspace'
  saveState: TreeSaveState
  /** The canvas zoom, which decides whether the name has to counter-scale. */
  zoom: number
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  /**
   * Close this tree. App waits for main's answer and shows a refusal, so
   * the header never drops it (review WR-03).
   */
  onClose?: () => void
  /** 'tree' (the default) or a workspace folder's frame. */
  variant?: 'tree' | 'folder'
  /** Folder variant: whether the folder is drawn as its header only. */
  collapsed?: boolean
  /** Folder variant: the collapse/expand button. */
  onToggleCollapsed?: () => void
  /** Folder variant: how many files the folder holds, at any depth. */
  fileCount?: number
}

/**
 * Below this zoom the frame name counter-scales (DRAW-03, UA-11).
 *
 * The name is 18px, and 18 * 0.72 is just under 13px — the Label size, which
 * this contract treats as the floor for readable text. Zoomed out further, the
 * name would keep shrinking with the canvas until a space full of frames was
 * a space full of unreadable labels, so below 0.72 it stops shrinking.
 */
const NAME_MIN_LEGIBLE_ZOOM = 0.72

/** What kind of tree this is, in the person's words rather than the code's. */
const kindLabels: Record<'native' | 'vault' | 'workspace', string> = {
  native: 'Tapestry world',
  vault: 'Obsidian vault',
  workspace: 'Workspace folder',
}

/** Carried from SaveIndicator: the three states a native tree can be in. */
const statusText: Record<TreeSaveState, string> = {
  saved: 'Saved',
  saving: 'Saving...',
  error: 'Not saved',
}

/** Chevron for the folder toggle: pointing down when open, right when collapsed. */
function ChevronGlyph({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ transform: open ? undefined : 'rotate(-90deg)' }}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

/** Three-dot overflow glyph. The button's label carries the meaning. */
function OverflowGlyph(): React.ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  )
}

export default function FrameHeader({
  treeId,
  name,
  kind,
  saveState,
  zoom,
  onPointerDown,
  onClose,
  variant = 'tree',
  collapsed = false,
  onToggleCollapsed,
  fileCount = 0,
}: FrameHeaderProps): React.ReactElement {
  const isFolder = variant === 'folder'
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const { openChat } = useContext(ChatContext)

  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  /**
   * What Tree options can do to a tree (UI-SPEC "Frame header").
   *
   * Close tree carries no confirmation by contract (UA-17): the files and the
   * history stay on disk, so the tooltip says so rather than a dialog asking.
   */
  const menuItems: Array<{ label: string; title?: string; run: () => void }> = [
    {
      label: 'Show in Finder',
      run: () => {
        void window.tapestry.trees.reveal(treeId)
      },
    },
    {
      label: 'Close tree',
      title: 'Removes the tree from this space. Files and history stay on disk.',
      run: () => {
        onClose?.()
      },
    },
  ]

  const closeMenu = useCallback((returnFocus: boolean) => {
    setIsMenuOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!isMenuOpen) return
    itemRefs.current[0]?.focus()
  }, [isMenuOpen])

  useEffect(() => {
    if (!isMenuOpen) return undefined

    const onPointerDownOutside = (event: MouseEvent): void => {
      const target = event.target as Node
      const insideMenu = menuRef.current?.contains(target) ?? false
      const onButton = buttonRef.current?.contains(target) ?? false
      if (!insideMenu && !onButton) setIsMenuOpen(false)
    }

    document.addEventListener('mousedown', onPointerDownOutside)
    return () => document.removeEventListener('mousedown', onPointerDownOutside)
  }, [isMenuOpen])

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
      return
    }
    if (event.key === 'Tab') {
      setIsMenuOpen(false)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    event.preventDefault()
    const count = menuItems.length
    const current = itemRefs.current.findIndex((element) => element === document.activeElement)
    const from = current === -1 ? 0 : current
    const next = event.key === 'ArrowDown' ? (from + 1) % count : (from - 1 + count) % count
    itemRefs.current[next]?.focus()
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // A click on a control, or inside its menu, is a click on that control
    // rather than the start of a frame drag.
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('.tapestry-menu')) return
    onPointerDown(e)
  }

  const status = isFolder ? `${fileCount} ${fileCount === 1 ? 'file' : 'files'}` : statusText[saveState]
  const workspaceStatus = useWorkspaceStatus(treeId)
  const watchLine = !isFolder && kind === 'workspace' ? workspaceStatusLine(workspaceStatus) : null
  // Not recording outside changes outranks the save state; a save error
  // outranks "Watching". Before main has said anything, the save state shows.
  const slot =
    watchLine && (watchLine.tone === 'destructive' || saveState !== 'error')
      ? { text: watchLine.text, error: watchLine.tone === 'destructive' }
      : { text: status, error: saveState === 'error' }
  const toggleLabel = collapsed ? 'Expand folder' : 'Collapse folder'

  return (
    <div className="tapestry-frame-header" onPointerDown={handlePointerDown}>
      <div className="tapestry-frame-header-row">
        <span
          className="tapestry-frame-name"
          title={name}
          style={
            zoom < NAME_MIN_LEGIBLE_ZOOM
              ? {
                  // Undo exactly as much of the canvas scale as it takes to
                  // hold 13px on screen, from the left so the name still
                  // starts where the frame does.
                  transform: `scale(${NAME_MIN_LEGIBLE_ZOOM / zoom})`,
                  transformOrigin: 'left center',
                }
              : undefined
          }
        >
          {name}
        </span>

        {isFolder && (
          <button
            type="button"
            className="tapestry-icon-button tapestry-frame-folder-toggle"
            aria-label={`${toggleLabel} ${name}`}
            aria-expanded={!collapsed}
            title={toggleLabel}
            onClick={() => onToggleCollapsed?.()}
          >
            <ChevronGlyph open={!collapsed} />
          </button>
        )}

        {!isFolder && kind === 'workspace' && (
          <button
            type="button"
            className="tapestry-frame-chat-button"
            title="Start a new chat in this workspace"
            onClick={() => openChat({ treeId })}
          >
            New chat
          </button>
        )}

        {!isFolder && (
        <span className="tapestry-frame-menu-wrap">
          <button
            ref={buttonRef}
            type="button"
            className="tapestry-icon-button"
            aria-label="Tree options"
            title="Tree options"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <OverflowGlyph />
          </button>

          {isMenuOpen && (
            <div
              ref={menuRef}
              className="tapestry-menu tapestry-menu--right"
              role="menu"
              aria-label="Tree options"
              onKeyDown={handleMenuKeyDown}
            >
              {menuItems.map((item, index) => (
                <button
                  key={item.label}
                  ref={(element) => {
                    itemRefs.current[index] = element
                  }}
                  type="button"
                  role="menuitem"
                  className="tapestry-menu-item"
                  title={item.title}
                  onClick={() => {
                    closeMenu(false)
                    item.run()
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </span>
        )}
      </div>

      <div className="tapestry-frame-header-row">
        {isFolder ? (
          <span className="tapestry-frame-kind" title={`Folder · ${status}`}>
            Folder · {status}
          </span>
        ) : (
          <>
            <span className="tapestry-frame-kind">{kindLabels[kind]}</span>
            <span
              className={
                slot.error ? 'tapestry-frame-status tapestry-frame-status--error' : 'tapestry-frame-status'
              }
              title={slot.text}
              role={slot.error ? 'status' : undefined}
            >
              {slot.text}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
