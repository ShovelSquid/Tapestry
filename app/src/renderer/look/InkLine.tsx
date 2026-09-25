/**
 * `<InkLine>`: an ink line as an SVG overlay (Line Lab v2, Part 2 wave 1).
 *
 * The SVG sits at the owner's (0, 0) with overflow visible, so the shape's
 * world px are the card's own CSS px and the line scales with the card:
 * static weight, drawn once. None of the props is the zoom, so zooming
 * never rebuilds a path.
 *
 * Two optional animations, both through the shared frame scheduler and
 * written straight to the path's `d`, never through React state:
 *
 * - `takeover`: the selection. The active tone (blue) grows both ways from
 *   `fromT` and *replaces* the base tone (pencil) as it goes, and waves
 *   where it has reached; turning it off runs the same grow backwards
 *   (Line Lab tasks 3 and 6).
 * - `wave`: the whole line waves (the hovered red dot; connections).
 *
 * A line with neither animation, or with motion turned off, requests no
 * frames at all.
 */

import { memo, useEffect, useMemo, useRef } from 'react'
import { blueReach, inkPath, loopWave, type InkShape, type Wave } from './ink'
import { Amount, easeOutCubic, effectStrength, frameScheduler, readMotionSettings } from './motion'
import { LOOK } from './values'

export type InkTone = 'pencil' | 'select' | 'delete'

const TONE: Record<InkTone, string> = {
  pencil: 'var(--tap-pencil)',
  select: 'var(--tap-select)',
  delete: 'var(--tap-delete)',
}

/** Line Lab draws the blue a touch heavier than the pencil it replaces. */
export const SELECT_WEIGHT = 1.05

export interface InkTakeover {
  readonly on: boolean
  /** Where the blue starts, as a t on the shape (see `nearestT`). */
  readonly fromT: number
  readonly tone?: InkTone
}

export interface InkLineProps {
  readonly shape: InkShape
  readonly tone?: InkTone
  /** World px at 100% zoom; defaults to the tuned weight. */
  readonly weight?: number
  readonly seed?: number
  /** Wave the whole line at this multiple of the tuned height. */
  readonly wave?: number
  /** This loop's length over a note outline's (fewer waves on small loops). */
  readonly waveScale?: number
  readonly takeover?: InkTakeover
  /** Hold an open line's ends still while it waves (connections). */
  readonly pinEnds?: boolean
  /** Render as a `<g>` for a line drawn inside an existing SVG (connections). */
  readonly inSvg?: boolean
  readonly className?: string
}

const SVG_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  overflow: 'visible',
  pointerEvents: 'none',
} as const

/** Both paths of a line at one moment: base tone where the blue isn't, blue where it is. */
export function inkLinePaths(
  props: Pick<InkLineProps, 'shape' | 'weight' | 'seed' | 'waveScale' | 'pinEnds'> & {
    readonly grow: number
    readonly fromT: number
    readonly waveAmp: number
    readonly nowMs: number
  },
): { base: string; active: string } {
  const { shape, grow, fromT, waveAmp, nowMs } = props
  const seed = props.seed ?? 0
  const weight = props.weight ?? LOOK.line.weightPx
  const loop: Wave | null = waveAmp > 0 ? loopWave(props.waveScale ?? 1, nowMs, waveAmp) : null
  const wave: Wave | null = loop && props.pinEnds ? (t) => loop(t) * Math.sin(Math.PI * t) : loop
  const reach = blueReach(grow, fromT, seed)
  if (!reach) return { base: inkPath(shape, { weight, seed, wave }), active: '' }
  const base = grow >= 1 ? '' : inkPath(shape, { weight, seed, filter: (t) => !reach(t) })
  const active = inkPath(shape, { weight: weight * SELECT_WEIGHT, seed, filter: reach, wave })
  return { base, active }
}

function InkLineImpl(props: InkLineProps): React.ReactElement {
  const { shape, tone = 'pencil', weight, seed = 0, wave = 0, waveScale = 1, takeover, pinEnds = false, inSvg = false, className } = props
  const on = takeover?.on ?? false
  const fromT = takeover?.fromT ?? 0
  const activeTone = takeover?.tone ?? 'select'

  const baseRef = useRef<SVGPathElement>(null)
  const activeRef = useRef<SVGPathElement>(null)
  const grow = useRef<Amount | null>(null)
  if (!grow.current) grow.current = new Amount(LOOK.motion.selectionGrowMs, easeOutCubic, on ? 1 : 0)

  // The first paint: built once per shape, never per zoom.
  const initial = useMemo(
    () =>
      inkLinePaths({
        shape,
        weight,
        seed,
        waveScale,
        pinEnds,
        grow: grow.current?.value ?? 0,
        fromT,
        waveAmp: 0,
        nowMs: 0,
      }),
    // Only the geometry rebuilds the first paint; animation state is
    // written by the frame loop below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape, weight, seed],
  )

  useEffect(() => {
    const amount = grow.current as Amount
    amount.set(on ? 1 : 0)
    const settings = readMotionSettings()
    const growStrength = effectStrength(settings, 'selectionGrow')
    const waveStrength = effectStrength(settings, 'selectionWave')
    // The selection waves where the blue has reached; `wave` waves it all.
    const waveAmpFor = (g: number): number => (wave > 0 ? wave : g > 0 ? 1 : 0) * waveStrength

    const paint = (nowMs: number): void => {
      const g = amount.value
      const { base, active } = inkLinePaths({ shape, weight, seed, waveScale, pinEnds, grow: g, fromT, waveAmp: waveAmpFor(g), nowMs })
      baseRef.current?.setAttribute('d', base)
      activeRef.current?.setAttribute('d', active)
    }

    const moving = (): boolean => !amount.settled || waveAmpFor(amount.value) > 0
    if (!amount.settled && growStrength <= 0) amount.step(0, 0)
    paint(0)
    if (!moving()) return

    const unsubscribe = frameScheduler().subscribe((nowMs, dtMs) => {
      amount.step(dtMs, growStrength)
      paint(nowMs)
      if (!moving()) unsubscribe()
    })
    return unsubscribe
  }, [shape, weight, seed, wave, waveScale, pinEnds, on, fromT])

  const cls = className ? `ink-line ${className}` : 'ink-line'
  const paths = (
    <>
      <path ref={baseRef} d={initial.base} fill={TONE[tone]} />
      <path ref={activeRef} d={initial.active} fill={TONE[activeTone]} />
    </>
  )
  if (inSvg) return <g className={cls}>{paths}</g>
  return (
    <svg className={cls} style={SVG_STYLE} aria-hidden="true">
      {paths}
    </svg>
  )
}

export const InkLine = memo(InkLineImpl)
