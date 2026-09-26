/**
 * Zoom collapse (Line Lab v2, Part 2 wave 5; spec §2a).
 *
 * As a note shrinks on screen it collapses: note → circle → node dot. The
 * rule is the note's width on screen against two thresholds, circle below
 * 110 px and dot below 28 px (`LOOK.collapse`, tuned in Line Lab). A note's
 * own lines scale with zoom; the circle and the dot are fixed on screen
 * (fixed size, 1 px line, drawn once). The switch between forms is a
 * crossfade, which covers the difference in line weight at each handoff.
 *
 * Thresholds are per note in the spec, but storing them on the note is a new
 * record shape (⚠ gate 2), so `thresholdsFor` gives every note the defaults
 * until Kaelen approves the names. Note settings shows them read-only.
 *
 * Pure functions plus one small tracker; no React, no DOM. Render-only:
 * nothing here reaches the `.tree`.
 */

import { LOOK } from './values'

export type CollapsedForm = 'circle' | 'dot'
export type NoteForm = 'note' | CollapsedForm

/** How a note is shown this frame; `hidden` is inside a collapsed note. */
export type ShownForm = NoteForm | 'hidden'

export interface CollapseThresholds {
  readonly circleBelowPx: number
  readonly dotBelowPx: number
}

/** The thresholds a note uses. Every note gets the defaults until gate 2. */
export function thresholdsFor(_noteId: string): CollapseThresholds {
  return LOOK.collapse
}

/** The form a note of this width on screen (px) is drawn in. */
export function collapseForm(screenWidth: number, t: CollapseThresholds = LOOK.collapse): NoteForm {
  if (screenWidth < t.dotBelowPx) return 'dot'
  if (screenWidth < t.circleBelowPx) return 'circle'
  return 'note'
}

/** The circle chip: the size of the `f` button's circle, in screen px (Line Lab). */
export const CIRCLE = Object.freeze({
  /** Radius in screen px. */
  r: 22,
  /** The title's first letter, in screen px. */
  letterPx: 17,
})

/** The node dot's radius on screen: 1.4 line weights, as Line Lab draws it. */
export const DOT_R = LOOK.line.weightPx * 1.4

/** The dot is tiny; this is the radius a pointer can hit it within, on screen. */
export const DOT_HIT_R = 8

/** The letter a circle shows: the title's first character, or a dot for none. */
export function circleLetter(title: string): string {
  const first = [...title.trim()][0]
  return first ? first.toLocaleUpperCase() : '·'
}

// ---------------------------------------------------------------------------
// Crossfade tracker
// ---------------------------------------------------------------------------

export interface FormFade {
  readonly from: ShownForm
  readonly to: ShownForm
  readonly atMs: number
}

const NONE: ReadonlySet<string> = new Set()

/**
 * Remembers each note's last shown form and fades between forms when one
 * changes. `update` is called once per render with every note's form; it
 * returns the fades still running. A note that goes away is forgotten.
 * With `durationMs` 0 (the `collapseFade` effect off) nothing fades, and a
 * note in `instant` (one flying in or out, look/enter.ts) changes form
 * without a fade and stops any fade it had.
 */
export class FormFades {
  private last = new Map<string, ShownForm>()
  private fades = new Map<string, FormFade>()

  update(
    forms: ReadonlyMap<string, ShownForm>,
    nowMs: number,
    durationMs: number,
    instant: ReadonlySet<string> = NONE,
  ): ReadonlyMap<string, FormFade> {
    const next = new Map<string, FormFade>()
    for (const [id, form] of forms) {
      if (instant.has(id)) continue
      const was = this.last.get(id)
      const running = this.fades.get(id)
      if (was !== undefined && was !== form && durationMs > 0) {
        next.set(id, { from: was, to: form, atMs: nowMs })
      } else if (running && running.to === form && nowMs - running.atMs < durationMs) {
        next.set(id, running)
      }
    }
    this.last = new Map(forms)
    this.fades = next
    return next
  }

  /** When the soonest running fade ends, or null when none is running. */
  nextEndMs(durationMs: number): number | null {
    let end: number | null = null
    for (const fade of this.fades.values()) {
      const at = fade.atMs + durationMs
      if (end === null || at < end) end = at
    }
    return end
  }
}

/**
 * The forms to draw for a note this frame: its current form, fading in if a
 * fade is running, and the form it left, fading out. `hidden` draws nothing.
 */
export function formsToDraw(
  form: ShownForm,
  fade: FormFade | undefined,
): Array<{ form: NoteForm; fade: 'in' | 'out' | null }> {
  const out: Array<{ form: NoteForm; fade: 'in' | 'out' | null }> = []
  if (fade && fade.from !== 'hidden' && fade.from !== form) out.push({ form: fade.from, fade: 'out' })
  if (form !== 'hidden') out.push({ form, fade: fade ? 'in' : null })
  return out
}
