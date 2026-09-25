/**
 * ConnectionLine -- a connection between two world-space points, drawn as a
 * blue waving ink line (Line Lab v2 wave 4, sketch 4).
 *
 * Resting connections are `--tap-select` ink at the notes' static weight,
 * sagging a little and waving with their ends held still. The live line
 * while a connection is dragged (`isTemporary`) is the same ink ending in a
 * blue dot under the pointer. A connection that has just landed flashes
 * `--tap-connect-flash`, then rests blue: `landedAt` is the canvas's
 * "landed" event, and a line that mounts within the flash window of it is
 * the new one.
 *
 * The SVG element sits inside the transformed canvas container so lines
 * pan and zoom with the notes. The ink shape is memoised on the rounded
 * ends, so a line whose ends don't move never rebuilds its path.
 */

import React, { useMemo, useState } from 'react'
import { InkLine } from '../look/InkLine'
import { seedFromId } from '../look/ink'
import {
  CONNECTION_FLASH_WINDOW_MS,
  CONNECTION_WAVE,
  connectionShape,
  connectionWaveScale,
} from '../look/connection'

interface ConnectionLineProps {
  x1: number
  y1: number
  x2: number
  y2: number
  /** When true, this is the live line of a connection being dragged. */
  isTemporary?: boolean
  /** Seeds the line's wobble; the edge id, so it's stable across reloads. */
  seedKey?: string
  /** When the canvas last saw a connection land in this tree (performance.now()). */
  landedAt?: number | null
}

/** Radius of the dot at the end of the live line, in world px. */
export const DRAG_DOT_R = 3

const q = (v: number): number => Math.round(v * 2) / 2

export default function ConnectionLine({
  x1,
  y1,
  x2,
  y2,
  isTemporary = false,
  seedKey = 'live',
  landedAt = null,
}: ConnectionLineProps): React.ReactElement {
  const seed = useMemo(() => seedFromId(seedKey), [seedKey])
  const ax = q(x1)
  const ay = q(y1)
  const bx = q(x2)
  const by = q(y2)
  const shape = useMemo(() => connectionShape({ x: ax, y: ay }, { x: bx, y: by }, seed), [ax, ay, bx, by, seed])
  // Decided once, on mount: only the line that lands flashes, never one
  // that was already here when a later connection landed.
  const [flash] = useState(
    () => !isTemporary && landedAt !== null && performance.now() - landedAt < CONNECTION_FLASH_WINDOW_MS,
  )

  return (
    <g className="connection-line">
      <InkLine
        shape={shape}
        tone="select"
        seed={seed}
        wave={isTemporary ? 0 : CONNECTION_WAVE}
        waveScale={connectionWaveScale(shape)}
        pinEnds
        className={flash ? 'connection-ink connection-landed' : 'connection-ink'}
      />
      {isTemporary && <circle className="connection-drag-dot" cx={x2} cy={y2} r={DRAG_DOT_R} />}
    </g>
  )
}
