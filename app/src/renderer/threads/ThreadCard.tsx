/**
 * ThreadCard -- the canvas-level card for a thread node (D-09).
 *
 * Unlike NoteCard, this card holds no ProseMirror editor of its own: D-02's
 * document lives in exactly one place, the ThreadOverlay's collab-backed
 * view, and RESEARCH's editor-and-app-integration finding is explicit that
 * two ProseMirror instances over the same document is unreadable to both.
 * Clicking the card calls `onStartEditing`, the same callback NoteCard uses
 * -- TreeFrame already tracks one `editingKey` for whichever node is being
 * edited, and App.tsx opens the ThreadOverlay when that node is a thread,
 * so no new plumbing is needed between here and Canvas.tsx.
 *
 * The title field is the one piece of inline editing this card does own,
 * copying NoteCard's ref-held save callback and debounce-flush-on-unmount
 * pattern so a stale closure can never drop an in-flight title edit. Saving
 * a title calls the same `onSave(nodeId, body, title)` prop TreeFrame already
 * wires for NoteCard, passing the node's current (unchanged) body through --
 * ThreadService, not this card, is the only writer of `body` (its D-06
 * checkpoint).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'

/** The node type this card renders, matching the plugin manifest's
 * `contributions.nodeTypes` entry exactly (`===`, never a substring match --
 * KnotNode's T-02.3-01-01 precedent). */
export const THREAD_TYPE = 'tapestry.threads/thread@1'

export interface ThreadNodeInfo {
  id: string
  type: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

export interface ThreadCardProps {
  node: ThreadNodeInfo
  isEditing: boolean
  isHovered: boolean
  isSelected: boolean
  zoom: number
  onStartEditing: () => void
  onBorderSelect: () => void
  onSave: (nodeId: string, body: string, title: string) => Promise<void>
  onMarkDirty: (nodeId: string) => void
  onMarkClean: (nodeId: string) => void
  onHover: (hovered: boolean) => void
  onRegisterDims: (id: string, width: number, height: number) => void
}

function getNodeProp(node: ThreadNodeInfo, key: string, fallback: string | number = ''): string | number {
  const prop = node.props[key]
  return prop ? (prop.value as string | number) : fallback
}

export default function ThreadCard({
  node,
  isEditing,
  isHovered,
  isSelected,
  onStartEditing,
  onBorderSelect,
  onSave,
  onMarkDirty,
  onMarkClean,
  onHover,
  onRegisterDims,
}: ThreadCardProps): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null)

  const x = Number(getNodeProp(node, 'position.x', 0))
  const y = Number(getNodeProp(node, 'position.y', 0))
  const title = String(getNodeProp(node, 'title', ''))
  const body = String(getNodeProp(node, 'body', ''))

  const [localTitle, setLocalTitle] = useState(title)
  const localTitleRef = useRef(title)
  localTitleRef.current = localTitle

  const bodyRef = useRef(body)
  bodyRef.current = body

  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onMarkCleanRef = useRef(onMarkClean)
  onMarkCleanRef.current = onMarkClean

  useEffect(() => {
    setLocalTitle(title)
  }, [title])

  useEffect(() => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      onRegisterDims(node.id, rect.width, rect.height)
    }
  })

  // Flush a pending title edit on unmount/node-switch, exactly like
  // NoteCard's D-02 autosave rule: a timer that fires against a dead
  // component must not silently mark "Saved" and skip the save.
  useEffect(() => {
    const nodeId = node.id
    return () => {
      if (!titleDebounceRef.current) return
      clearTimeout(titleDebounceRef.current)
      titleDebounceRef.current = null
      onMarkCleanRef.current(nodeId)
      onSaveRef.current(nodeId, bodyRef.current, localTitleRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onStartEditing()
    },
    [onStartEditing],
  )

  const handleBorderClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onBorderSelect()
    },
    [onBorderSelect],
  )

  const previewText = body ? previewFromBody(body) : 'Click to open this thread'

  const isHighlighted = isEditing || isSelected

  // Inline styles rather than an App.css class: this card's visual design
  // (session-note geometry, markers) is explicitly Claude's discretion for a
  // later plan (CONTEXT.md), so only the layout this tracer needs -- absolute
  // positioning matching NoteCard's, a readable border -- is set here.
  const cardStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${x}px`,
    top: `${y}px`,
    minWidth: 200,
    maxWidth: 400,
    background: '#F4F1E8',
    border: isHighlighted ? '2px solid #4A7CFF' : '1px solid #C8C5BE',
    borderRadius: 8,
    padding: '16px 16px 12px',
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.06)',
  }

  return (
    <div
      ref={cardRef}
      style={cardStyle}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={handleClick}
    >
      <div style={{ height: 8, marginBottom: 4, cursor: 'grab' }} onClick={handleBorderClick} />
      <input
        type="text"
        value={localTitle}
        placeholder="Untitled thread"
        style={{ border: 'none', background: 'transparent', fontWeight: 600, fontSize: 14, width: '100%' }}
        onChange={(e) => {
          const newTitle = e.target.value
          setLocalTitle(newTitle)
          onMarkDirty(node.id)
          if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current)
          titleDebounceRef.current = setTimeout(() => {
            titleDebounceRef.current = null
            onMarkClean(node.id)
            onSaveRef.current(node.id, bodyRef.current, newTitle)
          }, 300)
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <div style={{ fontSize: 12, color: '#6B6B6B', marginTop: 6 }}>{previewText}</div>
      {isHovered && <div style={{ fontSize: 11, color: '#4A7CFF', marginTop: 6 }}>Click to open</div>}
    </div>
  )
}

/** A short, plain-text preview of the checkpoint body -- a full ProseMirror
 * render belongs to the overlay, not the card. */
function previewFromBody(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object') {
      const text = extractText(parsed as Record<string, unknown>)
      if (text) return text.slice(0, 120)
    }
  } catch {
    // Legacy plain text.
  }
  return body.slice(0, 120)
}

function extractText(node: Record<string, unknown>): string {
  if (typeof node.text === 'string') return node.text
  const content = node.content
  if (Array.isArray(content)) {
    return content.map((child) => extractText(child as Record<string, unknown>)).join(' ')
  }
  return ''
}
