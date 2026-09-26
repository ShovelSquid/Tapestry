/**
 * `<NoteInk>`: a note card's paper, hover bloom and pencil outline (Line Lab
 * v2, Part 2 wave 2). Line Lab's `drawNote` is the reference.
 *
 * Two layers inside the card, both in the card's own px so they scale and
 * tilt with it (static weight; see ink.ts):
 *
 * - Behind the text (`z-index: -1`; the card isolates its stacking
 *   context): the paper, filled through the wobbled outline, and the bloom,
 *   a radial light clipped to that same outline. The bloom's tween comes in
 *   as a prop and is played by the shared frame loop, written straight to
 *   the circle's attributes.
 * - Over the text: the outline as an `<InkLine>`, pencil, taken over by the
 *   blue while `blue` is on (selection, editing, connect target).
 *
 * The outline is built once per (width, height, seed), never per zoom.
 */

import { memo, useEffect, useId, useMemo, useRef } from 'react'
import { fillPath, inkShape, noteOutlinePts, type InkShape } from './ink'
import { InkLine } from './InkLine'
import { lightAt, lightRadius, lightSettled, type LightTween } from './bloom'
import { effectStrength, frameScheduler, readMotionSettings } from './motion'
import { LOOK } from './values'

/** A note's outline shape: memoise on (w, h, seed). */
export function noteShape(w: number, h: number, seed: number): InkShape {
  return inkShape(noteOutlinePts(w, h, seed), true, seed, { step: 2, cornerRadius: 16 })
}

export interface NoteInkProps {
  readonly shape: InkShape
  readonly w: number
  readonly h: number
  readonly seed: number
  readonly light: LightTween
  readonly blue: boolean
  /** Where the blue starts, as a t on the shape. */
  readonly blueFromT: number
}

const LAYER = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  overflow: 'visible',
  pointerEvents: 'none',
  zIndex: -1,
} as const

function NoteInkImpl({ shape, w, h, seed, light, blue, blueFromT }: NoteInkProps): React.ReactElement {
  // useId gives ':r0:'; colons don't belong in a url(#…) reference.
  const id = useId().replace(/:/g, '')
  const clipId = `note-clip-${id}`
  const gradId = `note-bloom-${id}`
  const fill = useMemo(() => fillPath(shape), [shape])
  const circleRef = useRef<SVGCircleElement>(null)

  useEffect(() => {
    const strength = effectStrength(readMotionSettings(), 'hoverBloom')
    const ms = strength > 0 ? LOOK.motion.hoverBloomMs : 0
    const paint = (nowMs: number): void => {
      const c = circleRef.current
      if (!c) return
      const L = lightAt(light, nowMs, ms)
      c.setAttribute('cx', String(L.x))
      c.setAttribute('cy', String(L.y))
      c.setAttribute('r', String(Math.max(0, lightRadius(L, w, h))))
    }
    const now = performance.now()
    paint(now)
    if (lightSettled(light, now, ms)) return
    const unsubscribe = frameScheduler().subscribe((nowMs) => {
      paint(nowMs)
      if (lightSettled(light, nowMs, ms)) unsubscribe()
    })
    return unsubscribe
  }, [light, w, h])

  return (
    <>
      <svg className="note-ink-paper" style={LAYER} aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <path d={fill} />
          </clipPath>
          <radialGradient id={gradId}>
            <stop offset="0" stopColor="var(--tap-surface)" stopOpacity="1" />
            <stop offset="0.8" stopColor="var(--tap-surface)" stopOpacity="0.95" />
            <stop offset="1" stopColor="var(--tap-surface)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d={fill} fill="var(--tap-note)" />
        <circle ref={circleRef} cx={0} cy={0} r={0} fill={`url(#${gradId})`} clipPath={`url(#${clipId})`} />
      </svg>
      <InkLine shape={shape} seed={seed} takeover={{ on: blue, fromT: blueFromT }} className="note-ink-outline" />
    </>
  )
}

export const NoteInk = memo(NoteInkImpl)
