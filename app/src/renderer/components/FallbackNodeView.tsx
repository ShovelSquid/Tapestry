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
  isSelected: boolean
  isHovered: boolean
  zoom: number
  onBorderSelect: () => void
  onHover: (hovered: boolean) => void
  onPositionChange: (nodeId: string, x: number, y: number) => void
  onRegisterDims: (id: string, width: number, height: number) => void
  /** Called when a property is edited inline (D-35). */
  onPropertyEdit?: (nodeId: string, key: string, type: string, value: string | number | boolean) => void
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
          border: '1px solid #4A7CFF',
          borderRadius: 3,
          padding: '1px 4px',
          fontSize: 12,
          fontFamily: 'monospace',
          background: '#fff',
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
        color: '#555',
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
  isSelected,
  isHovered,
  zoom,
  onBorderSelect,
  onHover,
  onPositionChange,
  onRegisterDims,
  onPropertyEdit,
}: FallbackNodeViewProps): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  const px = Number(node.props['position.x']?.value ?? 0)
  const py = Number(node.props['position.y']?.value ?? 0)
  const [localPos, setLocalPos] = useState({ x: px, y: py })

  // Sync from props when not dragging
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalPos({ x: px, y: py })
    }
  }, [px, py])

  // Register dims
  useEffect(() => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      onRegisterDims(node.id, rect.width / zoom, rect.height / zoom)
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
      const dx = (e.clientX - dragStartRef.current.x) / zoom
      const dy = (e.clientY - dragStartRef.current.y) / zoom
      setLocalPos({ x: px + dx, y: py + dy })
    },
    [px, py, zoom],
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

  // Filter out position props from display (they're not useful to show)
  const displayProps = Object.entries(node.props).filter(
    ([key]) => key !== 'position.x' && key !== 'position.y' && key !== 'width',
  )

  // Extract plugin name from type (e.g. "example.physics/body@1" -> "example.physics")
  const pluginName = node.type.split('/')[0] || node.type

  const borderColor = isSelected ? '#4A7CFF' : '#E0DDD7'
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
        background: '#FFFFFF',
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
          background: '#F0EDEA',
          borderBottom: '1px solid #E0DDD7',
          cursor: 'grab',
          fontSize: 11,
          fontWeight: 600,
          color: '#888',
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
          color: '#2C2C2C',
        }}
      >
        {node.type}
      </div>

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
                borderBottom: '1px solid #F0F0F0',
                gap: 8,
              }}
            >
              <span
                style={{
                  color: '#666',
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
            color: '#999',
            fontStyle: 'italic',
          }}
        >
          No properties
        </div>
      )}
    </div>
  )
}
