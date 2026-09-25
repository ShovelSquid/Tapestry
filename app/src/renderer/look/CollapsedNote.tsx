/**
 * `<CollapsedNote>`: a note too small on screen to read, drawn as a circle
 * chip or a node dot (Line Lab v2, Part 2 wave 5; spec §2a). Line Lab's
 * `drawCircleForm` and `drawDotForm` are the reference.
 *
 * Both forms sit at the note's centre and are **fixed on screen**: the
 * element is scaled by 1 / zoom inside the zoomed canvas, so the circle is
 * always 44 px across with a 1 px pencil edge, and the dot always 1.4 px in
 * radius. The circle's edge is built once from the note's seed and never
 * rebuilt on zoom; only the transform changes. A selected circle's edge is
 * taken over by the blue and waves, as a selected note does (Line Lab task
 * 3); a selected dot turns blue.
 *
 * Click selects; double-click zooms into the note, as the stage 1 outline
 * did. `fade` plays the crossfade in or out (App.css `tap-form-fade-*`).
 */

import { memo, useMemo } from 'react'
import { circlePts, inkShape, type InkShape } from './ink'
import { InkLine } from './InkLine'
import { CIRCLE, DOT_HIT_R, DOT_R, circleLetter, type CollapsedForm } from './collapse'

/** A note outline's length at the fallback size, for the circle's wave count. */
const NOTE_LOOP_L = 2 * (280 + 120)

/** The circle's pencil edge, in its own screen px around (0, 0). */
export function circleShape(seed: number): InkShape {
  return inkShape(circlePts(0, 0, CIRCLE.r), true, seed, { step: 1.5, wobbleScale: 0.25 })
}

export interface CollapsedNoteProps {
  readonly noteId: string
  readonly form: CollapsedForm
  readonly title: string
  readonly seed: number
  /** The note's centre, in the frame's world px. */
  readonly x: number
  readonly y: number
  readonly zoom: number
  readonly selected: boolean
  readonly fade: 'in' | 'out' | null
  readonly onSelect: () => void
  readonly onZoomTo: () => void
}

function CollapsedNoteImpl({
  noteId,
  form,
  title,
  seed,
  x,
  y,
  zoom,
  selected,
  fade,
  onSelect,
  onZoomTo,
}: CollapsedNoteProps): React.ReactElement {
  const shape = useMemo(() => circleShape(seed), [seed])
  let className = `tapestry-collapsed tapestry-collapsed--${form}`
  if (selected) className += ' tapestry-collapsed--selected'
  if (fade) className += ` tap-form-fade-${fade}`
  const label = `${title || 'Untitled'} (zoom in to see)`
  const hitR = form === 'circle' ? CIRCLE.r : DOT_HIT_R

  return (
    <div
      className={className}
      data-node-id={noteId}
      data-form={form}
      style={{ left: x, top: y, transform: `scale(${1 / zoom})` }}
    >
      <div
        className="tapestry-collapsed-hit"
        role="button"
        aria-label={label}
        title={label}
        style={{ left: -hitR, top: -hitR, width: hitR * 2, height: hitR * 2 }}
        onClick={(e) => {
          e.stopPropagation()
          onSelect()
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onZoomTo()
        }}
      >
        {form === 'circle' ? (
          <>
            <svg className="tapestry-collapsed-paper" aria-hidden="true">
              <circle cx={CIRCLE.r} cy={CIRCLE.r} r={CIRCLE.r} />
            </svg>
            <span className="tapestry-collapsed-letter" style={{ fontSize: CIRCLE.letterPx }}>
              {circleLetter(title)}
            </span>
          </>
        ) : (
          <span
            className="tapestry-collapsed-dot"
            style={{ left: hitR - DOT_R, top: hitR - DOT_R, width: DOT_R * 2, height: DOT_R * 2 }}
          />
        )}
      </div>
      {form === 'circle' && (
        <InkLine
          shape={shape}
          seed={seed}
          waveScale={shape.L / NOTE_LOOP_L}
          takeover={{ on: selected, fromT: 0 }}
          className="tapestry-collapsed-edge"
        />
      )}
    </div>
  )
}

export const CollapsedNote = memo(CollapsedNoteImpl)
