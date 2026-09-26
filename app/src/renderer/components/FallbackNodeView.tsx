/**
 * FallbackNodeView -- generic readable fallback for nodes whose plugin is
 * missing or disabled.
 *
 * Per D-33: a missing or broken plugin never prevents a world from opening.
 * Nodes whose type has no loaded nodeView contribution render through this
 * component instead of being hidden.
 *
 * Per D-35: disabled plugin content remains readable and properties are
 * editable through a generic key-value editor.
 *
 * The fallback card uses the same card styling as a regular note (white
 * background, border, shadow) but with a muted header indicating the
 * plugin name is unavailable.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { layoutSize, screenDeltaToWorld } from '../layout/camera'
import { THREAD_TYPE } from '../threads/ThreadCard'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NodeInfo {
  id: string
  type: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

interface FallbackNodeViewProps {
  node: NodeInfo
  /** Needed only to read a thread's checkpoint `recorded` stamp (PLUG-04) —
   * every other kernel read this view needs is already on `node.props`. */
  treeId: string
  isSelected: boolean
  isHovered: boolean
  zoom: number
  /**
   * Where a following note is drawn, beside its grew-from parent (D-05). Set
   * only for a following note; every other note keeps its stored position.
   */
  displayPosition?: { x: number; y: number }
  /**
   * The drawn camera roll, in degrees. With zoom, it turns screen deltas into
   * world deltas, so a drag stays under the pointer on a rolled canvas.
   * Defaults to 0 (unrolled).
   */
  roll?: number
  onBorderSelect: () => void
  onHover: (hovered: boolean) => void
  onPositionChange: (nodeId: string, x: number, y: number) => void
  onRegisterDims: (id: string, width: number, height: number) => void
  /** Called when a property is edited inline (D-35). */
  onPropertyEdit?: (nodeId: string, key: string, type: string, value: string | number | boolean) => void
}

/** "[date], [time]" per the UI-SPEC no-plugin fallback notice, from an RFC
 * 3339 `recorded` stamp. */
function formatRecordedLabel(recorded: string): string {
  const date = new Date(recorded)
  if (Number.isNaN(date.getTime())) return recorded
  const datePart = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${datePart}, ${timePart}`
}

// ---------------------------------------------------------------------------
// Value formatter
// ---------------------------------------------------------------------------

function formatValue(type: string, value: string | number | boolean): string {
  switch (type) {
    case 'text':
      return `"${String(value)}"`
    case 'int':
    case 'real':
      return String(value)
    case 'bool':
      return value ? 'true' : 'false'
    case 'ref':
      return String(value)
    case 'time':
      return String(value)
    default:
      return String(value)
  }
}

// ---------------------------------------------------------------------------
// Inline editable value
// ---------------------------------------------------------------------------

function EditableValue({
  propKey,
  type,
  value,
  onSave,
}: {
  propKey: string
  type: string
  value: string | number | boolean
  onSave: (key: string, type: string, newValue: string | number | boolean) => void
}): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSave = useCallback(() => {
    let parsed: string | number | boolean = editValue
    if (type === 'int') parsed = parseInt(editValue, 10) || 0
    else if (type === 'real') parsed = parseFloat(editValue) || 0
    else if (type === 'bool') parsed = editValue === 'true'
    onSave(propKey, type, parsed)
    setIsEditing(false)
  }, [editValue, propKey, type, onSave])

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="fallback-value-input"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') setIsEditing(false)
        }}
        style={{
          border: '1px solid var(--tap-accent)',
          borderRadius: 3,
          padding: '1px 4px',
          fontSize: 12,
          fontFamily: 'monospace',
          background: 'var(--tap-surface)',
          outline: 'none',
          width: '100%',
          maxWidth: 200,
        }}
      />
    )
  }

  return (
    <span
      className="fallback-value"
      onClick={(e) => {
        e.stopPropagation()
        setIsEditing(true)
        setEditValue(String(value))
      }}
      style={{
        cursor: 'pointer',
        fontFamily: 'monospace',
        fontSize: 12,
        color: 'var(--tap-neutral-dark)',
      }}
      title="Click to edit"
    >
      {formatValue(type, value)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// FallbackNodeView
// ---------------------------------------------------------------------------

export default function FallbackNodeView({
  node,
  displayPosition,
  treeId,
  isSelected,
  // isHovered is accepted (Canvas passes it) but the fallback view has no
  // hover-only affordance yet, so it is intentionally not destructured.
  zoom,
  roll = 0,
  onBorderSelect,
  onHover,
  onPositionChange,
  onRegisterDims,
  onPropertyEdit,
}: FallbackNodeViewProps): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  const px = displayPosition ? displayPosition.x : Number(node.props['position.x']?.value ?? 0)
  const py = displayPosition ? displayPosition.y : Number(node.props['position.y']?.value ?? 0)
  const [localPos, setLocalPos] = useState({ x: px, y: py })

  // PLUG-04 / D-33 / D-35: a thread node whose plugin is disabled still
  // shows its `body` checkpoint text as the primary content, with a notice
  // naming when that checkpoint was last saved. The date/time comes from
  // the checkpoint commit's own `recorded` stamp, not the node's generic
  // "last changed" history (which would also be bumped by every thread.log
  // flush and therefore name the wrong moment -- see 02.3-03-PLAN.md Task 3).
  const isThread = node.type === THREAD_TYPE
  const [bodyRecorded, setBodyRecorded] = useState<string | null>(null)

  useEffect(() => {
    if (!isThread) return
    let cancelled = false
    window.tapestry.kernel
      .getPropertyValues(treeId, node.id, 'body')
      .then((entries) => {
        if (cancelled) return
        const last = entries[entries.length - 1]
        setBodyRecorded(last ? last.recorded : null)
      })
      .catch(() => {
        if (!cancelled) setBodyRecorded(null)
      })
    return () => {
      cancelled = true
    }
  }, [isThread, treeId, node.id])

  // Sync from props when not dragging
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalPos({ x: px, y: py })
    }
  }, [px, py])

  // Register dims
  useEffect(() => {
    if (cardRef.current) {
      const size = layoutSize(cardRef.current, zoom, roll)
      onRegisterDims(node.id, size.width, size.height)
    }
  })

  // Drag handling
  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      isDraggingRef.current = true
      dragStartRef.current = { x: e.clientX, y: e.clientY }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [],
  )

  const handleDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return
      const d = screenDeltaToWorld(
        e.clientX - dragStartRef.current.x,
        e.clientY - dragStartRef.current.y,
        zoom,
        roll,
      )
      setLocalPos({ x: px + d.x, y: py + d.y })
    },
    [px, py, zoom, roll],
  )

  const handleDragEnd = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      onPositionChange(node.id, localPos.x, localPos.y)
    },
    [node.id, localPos, onPositionChange],
  )

  const handlePropertySave = useCallback(
    (key: string, type: string, newValue: string | number | boolean) => {
      if (onPropertyEdit) {
        onPropertyEdit(node.id, key, type, newValue)
      }
    },
    [node.id, onPropertyEdit],
  )

  // Filter out position props from display (they're not useful to show).
  // A thread's `body` is also pulled out of the generic list: it gets its
  // own prominent, non-truncated, non-input rendering above the rest (PLUG-04)
  // instead of the click-to-edit monospace treatment every other value gets.
  const displayProps = Object.entries(node.props).filter(
    ([key]) =>
      key !== 'position.x' && key !== 'position.y' && key !== 'width' && !(isThread && key === 'body'),
  )

  // Extract plugin name from type (e.g. "example.physics/body@1" -> "example.physics")
  const pluginName = node.type.split('/')[0] || node.type
  const threadBodyText = isThread ? String(node.props.body?.value ?? '') : ''
  const threadNotice = bodyRecorded
    ? `Thread history needs the Threads plugin. The text below is the last saved version of the document, from ${formatRecordedLabel(bodyRecorded)}.`
    : 'Thread history needs the Threads plugin. The text below is the last saved version of the document.'

  const borderColor = isSelected ? 'var(--tap-accent)' : 'var(--tap-border)'
  const borderWidth = isSelected ? 2 : 1
  const shadow = isSelected
    ? '0 2px 8px rgba(0,0,0,0.10)'
    : '0 2px 4px rgba(0,0,0,0.06)'

  return (
    <div
      ref={cardRef}
      className="fallback-node-view"
      style={{
        position: 'absolute',
        left: localPos.x,
        top: localPos.y,
        width: 260,
        background: 'var(--tap-surface)',
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow: shadow,
        overflow: 'hidden',
        userSelect: 'none',
      }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onClick={(e) => {
        e.stopPropagation()
        onBorderSelect()
      }}
    >
      {/* Drag handle / header */}
      <div
        style={{
          padding: '8px 12px',
          background: 'var(--tap-surface-header)',
          borderBottom: '1px solid var(--tap-border)',
          cursor: 'grab',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--tap-neutral-light)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
      >
        {pluginName} (unavailable)
      </div>

      {/* Node type */}
      <div
        style={{
          padding: '8px 12px 4px',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--tap-ink)',
        }}
      >
        {node.type}
      </div>

      {/* PLUG-04 / D-33 / D-35: a thread's checkpoint text, above its other
          typed properties -- never truncated, never rendered inside an
          input, always selectable and copyable. */}
      {isThread && (
        <div style={{ padding: '0 12px 8px' }}>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: 12,
              lineHeight: 1.4,
              color: 'var(--tap-neutral-light)',
            }}
          >
            {threadNotice}
          </p>
          <div
            className="fallback-thread-body"
            style={{
              whiteSpace: 'pre-wrap',
              userSelect: 'text',
              cursor: 'text',
              fontSize: 16,
              fontWeight: 400,
              lineHeight: 1.5,
              color: 'var(--tap-ink)',
              padding: '8px 0',
              borderTop: '1px solid var(--tap-rule-light)',
              borderBottom: '1px solid var(--tap-rule-light)',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {threadBodyText}
          </div>
        </div>
      )}

      {/* Properties (D-35: readable and editable) */}
      {displayProps.length > 0 && (
        <div style={{ padding: '4px 12px 12px' }}>
          {displayProps.map(([key, prop]) => (
            <div
              key={key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '2px 0',
                fontSize: 12,
                borderBottom: '1px solid var(--tap-rule-light)',
                gap: 8,
              }}
            >
              <span
                style={{
                  color: 'var(--tap-neutral)',
                  fontWeight: 500,
                  flexShrink: 0,
                }}
              >
                {key}
              </span>
              <EditableValue
                propKey={key}
                type={prop.type}
                value={prop.value}
                onSave={handlePropertySave}
              />
            </div>
          ))}
        </div>
      )}

      {displayProps.length === 0 && (
        <div
          style={{
            padding: '8px 12px 12px',
            fontSize: 12,
            color: 'var(--tap-neutral-faint)',
            fontStyle: 'italic',
          }}
        >
          No properties
        </div>
      )}
    </div>
  )
}
