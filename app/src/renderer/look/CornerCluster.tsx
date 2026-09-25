/**
 * `<CornerCluster>`: a note's corner controls in the note look (Line Lab v2,
 * Part 2 wave 2). Replaces NoteControls' two bubbles on the note card.
 *
 * - The red delete dot sits on the top-left corner. Hovered, it grows by a
 *   third, whitens a little, takes the selection wave on its own pencil
 *   edge and shows ✕; on leave it eases back the same way (Line Lab tasks 2
 *   and 3). The hover is a 0→1 `Amount`, so a quick in-and-out reverses
 *   from where it is. Pressing it runs the existing delete path.
 * - The small blue dot on the top edge starts the existing connect flow.
 *
 * Both are buttons that act on pointer down and prevent default, so they
 * never move the caret or drop a text selection (D-07). Positions are in
 * the card's px, as in Line Lab (red at (4, 4), r 13; blue at (28, -2)).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { circlePts, inkShape, type InkShape } from './ink'
import { InkLine } from './InkLine'
import { Amount, effectStrength, frameScheduler, readMotionSettings, smoothstep } from './motion'
import { LOOK } from './values'

export const RED_DOT = Object.freeze({ x: 4, y: 4, r: 13 })
export const BLUE_DOT = Object.freeze({ x: 28, y: -2, r: 4.2 })
/** The red dot's hit box, big enough for the grown dot. */
const RED_BOX = 34
const RED_C = RED_BOX / 2
const BLUE_BOX = 16

export interface CornerClusterProps {
  readonly onConnect: () => void
  readonly onDelete: () => void
  /** The connect tooltip names a passage when text is selected. */
  readonly hasTextSelection?: boolean
  readonly seed: number
  /** The note outline's length, so the red dot's wave has the same size. */
  readonly noteLength: number
}

/** The red dot's own pencil edge, in its hit box's px. */
export function redDotShape(seed: number): InkShape {
  return inkShape(circlePts(RED_C, RED_C, RED_DOT.r), true, seed + 5, { step: 1.5, wobbleScale: 0.35 })
}

function CornerClusterImpl({ onConnect, onDelete, hasTextSelection, seed, noteLength }: CornerClusterProps): React.ReactElement {
  const [hover, setHover] = useState(false)
  const shape = useMemo(() => redDotShape(seed), [seed])
  const amount = useRef<Amount | null>(null)
  if (!amount.current) amount.current = new Amount(LOOK.detail.deleteDotMs, smoothstep)
  const discRef = useRef<SVGCircleElement>(null)
  const edgeRef = useRef<HTMLDivElement>(null)
  const crossRef = useRef<SVGGElement>(null)

  useEffect(() => {
    const a = amount.current as Amount
    a.set(hover ? 1 : 0)
    const strength = effectStrength(readMotionSettings(), 'deleteDot')
    const paint = (): void => {
      const rh = a.value
      const grow = 1 + 0.3 * rh
      discRef.current?.setAttribute('r', String(RED_DOT.r * grow))
      discRef.current?.setAttribute('fill', `color-mix(in srgb, var(--tap-delete), var(--tap-surface) ${Math.round(35 * rh)}%)`)
      if (edgeRef.current) {
        edgeRef.current.style.transform = `scale(${grow})`
        edgeRef.current.style.opacity = String(rh)
      }
      if (crossRef.current) {
        crossRef.current.setAttribute('opacity', String(rh))
        crossRef.current.setAttribute('transform', `translate(${RED_C} ${RED_C}) scale(${grow})`)
      }
    }
    if (strength <= 0) a.step(0, 0)
    paint()
    if (a.settled) return
    const unsubscribe = frameScheduler().subscribe((_now, dt) => {
      a.step(dt, strength)
      paint()
      if (a.settled) unsubscribe()
    })
    return unsubscribe
  }, [hover])

  const handleDeleteDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      onDelete()
    },
    [onDelete],
  )
  const handleConnectDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault() // Prevent focus steal (D-07)
      onConnect()
    },
    [onConnect],
  )

  // The ✕ arms, 0.36 of the radius out from the centre (Line Lab).
  const x = RED_DOT.r * 0.36
  return (
    <div className="tapestry-corner-cluster">
      <button
        className="tapestry-corner-dot tapestry-corner-dot--delete"
        style={{ left: RED_DOT.x - RED_C, top: RED_DOT.y - RED_C, width: RED_BOX, height: RED_BOX }}
        onPointerDown={handleDeleteDown}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        title="Delete note"
        aria-label="Delete note"
        tabIndex={-1}
      >
        <svg width={RED_BOX} height={RED_BOX} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} aria-hidden="true">
          <circle ref={discRef} cx={RED_C} cy={RED_C} r={RED_DOT.r} fill="var(--tap-delete)" />
          <g ref={crossRef} opacity={0} transform={`translate(${RED_C} ${RED_C})`} stroke="var(--tap-delete)" strokeWidth={1.2} strokeLinecap="round">
            <line x1={-x} y1={-x} x2={x} y2={x} />
            <line x1={x} y1={-x} x2={-x} y2={x} />
          </g>
        </svg>
        <div ref={edgeRef} className="tapestry-corner-dot-edge" style={{ transformOrigin: `${RED_C}px ${RED_C}px`, opacity: 0 }}>
          <InkLine shape={shape} tone="delete" seed={seed + 5} wave={hover ? 1 : 0} waveScale={noteLength > 0 ? shape.L / noteLength : 0.3} />
        </div>
      </button>
      <button
        className="tapestry-corner-dot tapestry-corner-dot--connect"
        style={{ left: BLUE_DOT.x - BLUE_BOX / 2, top: BLUE_DOT.y - BLUE_BOX / 2, width: BLUE_BOX, height: BLUE_BOX }}
        onPointerDown={handleConnectDown}
        title={hasTextSelection ? 'Connect selected text' : 'Connect to another note'}
        aria-label={hasTextSelection ? 'Connect selected text' : 'Connect to another note'}
        tabIndex={-1}
      >
        <span className="tapestry-corner-dot-blue" style={{ width: BLUE_DOT.r * 2, height: BLUE_DOT.r * 2 }} />
      </button>
    </div>
  )
}

export const CornerCluster = memo(CornerClusterImpl)
