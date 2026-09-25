/**
 * VaultNoteCard — a vault note shown as its file actually reads (D-12, D-30).
 *
 * The body is `md.text` verbatim, in `white-space: pre-wrap`: the same
 * characters Obsidian shows in source mode, including the `---` frontmatter
 * fence, the `[[` brackets and the `#` of a tag. Nothing is rendered, hidden or
 * prettified, because the whole claim of a vault tree is that it says what the
 * file says. Plan 09 styles those spans; it still never removes a character.
 *
 * Read-only in this plan. Editing a vault note writes to the `.md` file, and
 * that path (with its debounce and its "file wins" rule) is Plan 10 — a card
 * that accepted typing before the write path existed would silently lose it.
 *
 * Dragging is Tapestry's, not the vault's: it commits `position.x`/`position.y`
 * to the vault tree and never touches the file (D-14).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { NodeInfo } from './Canvas'
import ProvenanceBadge, { actorSpokenText } from './ProvenanceBadge'
import { layoutSize, screenDeltaToWorld } from '../layout/camera'

interface VaultNoteCardProps {
  node: NodeInfo
  isSelected: boolean
  zoom: number
  /**
   * The drawn camera roll, in degrees. With zoom, it turns screen deltas into
   * world deltas, so a drag stays under the pointer on a rolled canvas.
   * Defaults to 0 (unrolled).
   */
  roll?: number
  /** Who recorded this note, derived from the journal (D-05, D-21). */
  provenance?: TapestryNodeHistory
  onBorderSelect: () => void
  onHover: (hovered: boolean) => void
  onPositionChange: (nodeId: string, x: number, y: number) => void
  onRegisterDims: (id: string, width: number, height: number) => void
  onDragMove?: (nodeId: string, x: number, y: number) => void
  onDragEnd?: (nodeId: string) => void
}

/** The card's width before Kaelen resizes it. */
const DEFAULT_VAULT_CARD_WIDTH = 280

function propString(node: NodeInfo, key: string, fallback = ''): string {
  const prop = node.props[key]
  return prop && typeof prop.value === 'string' ? prop.value : fallback
}

/**
 * The title is the file name without `.md`, because in Obsidian that IS the
 * title (D-28). It is derived rather than stored, so it can never disagree with
 * `md.path`.
 */
export function vaultNoteTitle(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.replace(/\.md$/i, '')
}

export default function VaultNoteCard({
  node,
  isSelected,
  zoom,
  roll = 0,
  provenance,
  onBorderSelect,
  onHover,
  onPositionChange,
  onRegisterDims,
  onDragMove,
  onDragEnd,
}: VaultNoteCardProps): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 })

  const x = Number(node.props['position.x']?.value ?? 0)
  const y = Number(node.props['position.y']?.value ?? 0)
  const storedWidth = node.props['width'] ? Number(node.props['width'].value) : 0

  const path = propString(node, 'md.path')
  const text = propString(node, 'md.text')

  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null)
  const effectiveX = localPos ? localPos.x : x
  const effectiveY = localPos ? localPos.y : y

  // Clear the local override once the committed position arrives, so the card
  // does not jump between the dragged spot and the stored one.
  useEffect(() => {
    if (!isDraggingRef.current && localPos) setLocalPos(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y])

  useEffect(() => {
    if (cardRef.current) {
      const size = layoutSize(cardRef.current, zoom, roll)
      onRegisterDims(node.id, size.width, size.height)
    }
  })

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
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
        const d = screenDeltaToWorld(
          me.clientX - dragStartRef.current.mouseX,
          me.clientY - dragStartRef.current.mouseY,
          zoom,
          roll,
        )
        const nextX = dragStartRef.current.startX + d.x
        const nextY = dragStartRef.current.startY + d.y
        setLocalPos({ x: nextX, y: nextY })
        onDragMove?.(node.id, nextX, nextY)
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
    [effectiveX, effectiveY, zoom, roll, node.id, onPositionChange, onDragMove, onDragEnd],
  )

  // ----- Provenance footer (D-06, D-07, D-21) -----
  //
  // A vault note is always machine-attributed — `obsidian.bridge` observed it —
  // so its footer stays visible rather than appearing on hover. That is the
  // honest reading: nobody in Tapestry wrote this note.
  let provenanceFooter: React.ReactElement | null = null
  if (provenance) {
    const { createdBy, changedBy } = provenance
    const wasChangedByOther = changedBy.kind !== createdBy.kind || changedBy.id !== createdBy.id
    provenanceFooter = (
      <div
        className="tapestry-provenance-footer"
        title={
          `Created by ${createdBy.id} in change ${provenance.createdSeq}. ` +
          `Last changed by ${changedBy.id} in change ${provenance.changedSeq}.`
        }
        role="group"
        aria-label={
          wasChangedByOther
            ? `Created by ${actorSpokenText(createdBy)}, changed by ${actorSpokenText(changedBy)}`
            : `Created by ${actorSpokenText(createdBy)}`
        }
      >
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

  const width = storedWidth > 0 ? storedWidth : DEFAULT_VAULT_CARD_WIDTH

  return (
    <div
      ref={cardRef}
      className={`tapestry-note-card${isSelected ? ' tapestry-note-card--selected' : ''}`}
      style={{
        left: `${effectiveX}px`,
        top: `${effectiveY}px`,
        width: `${width}px`,
        maxWidth: 'none',
      }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <div
        className="tapestry-note-drag-handle"
        onPointerDown={handleDragStart}
        onClick={(e) => {
          e.stopPropagation()
          onBorderSelect()
        }}
      />

      {/* Note Title (18/600/1.25) — the file name without .md (UI-SPEC) */}
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          lineHeight: 1.25,
          color: '#2C2C2C',
          marginBottom: 8,
        }}
      >
        {vaultNoteTitle(path)}
      </div>

      {/* Body (16/400/1.5), pre-wrap — the file's own characters, unaltered */}
      <div
        style={{
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 1.5,
          color: '#2C2C2C',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </div>

      {provenanceFooter}
    </div>
  )
}
