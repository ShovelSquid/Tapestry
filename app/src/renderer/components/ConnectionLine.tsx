/**
 * ConnectionLine -- renders an SVG line between two world-space points.
 *
 * Default color: warm gray #B0ADA6 (UI-SPEC thread line default).
 * Temporary (connecting-mode) lines use accent #4A7CFF.
 *
 * The SVG element sits inside the transformed canvas container so lines
 * pan and zoom with the notes.
 */

import React from 'react'

interface ConnectionLineProps {
  x1: number
  y1: number
  x2: number
  y2: number
  /** When true, uses accent color for the connecting-mode preview line. */
  isTemporary?: boolean
}

export default function ConnectionLine({
  x1,
  y1,
  x2,
  y2,
  isTemporary = false,
}: ConnectionLineProps): React.ReactElement {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={isTemporary ? '#4A7CFF' : '#B0ADA6'}
      strokeWidth={isTemporary ? 2 : 1.5}
      strokeLinecap="round"
      strokeDasharray={isTemporary ? '6 4' : undefined}
    />
  )
}
