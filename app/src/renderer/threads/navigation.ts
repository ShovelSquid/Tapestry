/**
 * Navigation — fly-to, hover gravity, zoom-step arithmetic, the date
 * scrubber's day/centre mapping, and the keyboard map for the side view
 * (D-17; RESEARCH Pattern 5, `.claude/skills/spike-findings-tapestry`'s
 * "navigation-and-feel" reference for spike 011's own first-guess values
 * and gotchas).
 *
 * `flyTo` and `gravityStep`/`gravityWeight` are pure enough to unit test
 * directly (`navigation.test.ts`): `flyTo`'s only DOM touch is
 * `requestAnimationFrame`/`cancelAnimationFrame`, guarded so the module still
 * imports cleanly under vitest's node environment, and `gravityStep` takes
 * every input as a plain argument rather than reading the DOM itself.
 * `NAV_KEYS` is a lookup table, not a listener — `ThreadOverlay.tsx` owns
 * the actual `keydown` wiring; this module only says which action a key
 * means (UI-SPEC "Keyboard map").
 */

import { interpolateZoom } from 'd3-interpolate'
import { clampSpanSeconds } from './stage/side-view'

// ---------------------------------------------------------------------------
// Fly-to (D-17): van Wijk & Nuij perceptually uniform zoom-and-pan path
// ---------------------------------------------------------------------------

export interface FlyView {
  centerSeconds: number
  spanSeconds: number
}

export interface FlyToOptions {
  /** UI-SPEC "Motion and prefers-reduced-motion": under reduced motion,
   * fly-to is an instant jump rather than the interpolated flight, but still
   * fires `onDone` so the caller's own polite announcement still happens. */
  reducedMotion?: boolean
}

const MIN_FLY_DURATION_MS = 300
const MAX_FLY_DURATION_MS = 900

/**
 * Flies from `from` to `to` along `interpolateZoom`'s path (treating thread
 * time as the interpolator's own "x" axis and always passing `uy = 0`,
 * since the side view has no second axis to pan). Calls `onFrame` once per
 * animation frame with the interpolated `{ centerSeconds, spanSeconds }`,
 * and `onDone` once the flight completes. Duration scales with the path's
 * own length, clamped to 300-900ms (RESEARCH Pattern 5). Returns a cancel
 * function; calling it stops the flight without firing `onDone`.
 */
export function flyTo(
  from: FlyView,
  to: FlyView,
  onFrame: (view: FlyView) => void,
  onDone?: () => void,
  options: FlyToOptions = {},
): () => void {
  if (options.reducedMotion || typeof requestAnimationFrame !== 'function') {
    onFrame(to)
    onDone?.()
    return () => {}
  }

  const interpolator = interpolateZoom([from.centerSeconds, 0, from.spanSeconds], [to.centerSeconds, 0, to.spanSeconds])
  const rawDuration = Math.abs(interpolator.duration)
  const durationMs =
    Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.min(MAX_FLY_DURATION_MS, Math.max(MIN_FLY_DURATION_MS, rawDuration))
      : MIN_FLY_DURATION_MS

  let cancelled = false
  let rafId = 0
  const startedAt = performance.now()

  function step(): void {
    if (cancelled) return
    const t = Math.min(1, (performance.now() - startedAt) / durationMs)
    const [centerSeconds, , spanSeconds] = interpolator(t)
    onFrame({ centerSeconds, spanSeconds })
    if (t < 1) {
      rafId = requestAnimationFrame(step)
    } else {
      onDone?.()
    }
  }

  rafId = requestAnimationFrame(step)
  return () => {
    cancelled = true
    cancelAnimationFrame(rafId)
  }
}

// ---------------------------------------------------------------------------
// Zoom step (`+`/`-`: ×2 per press, around the focused point)
// ---------------------------------------------------------------------------

export const ZOOM_STEP_FACTOR = 2

/**
 * The new zoom span after one `+`/`-` press (UI-SPEC "Side view read-back":
 * "Zoom one step (×2 per press)"), clamped through `side-view.ts`'s own
 * `clampSpanSeconds` so a keyboard zoom and a wheel zoom can never disagree
 * about the [0.5s, 1.1×duration] limit.
 */
export function zoomStep(currentSpanSeconds: number, direction: 1 | -1, threadDurationSeconds: number): number {
  const next = direction > 0 ? currentSpanSeconds * ZOOM_STEP_FACTOR : currentSpanSeconds / ZOOM_STEP_FACTOR
  return clampSpanSeconds(next, threadDurationSeconds)
}

// ---------------------------------------------------------------------------
// Gravity (D-17: "there is no pull while moving freely")
// ---------------------------------------------------------------------------

export interface GravityInput {
  /** Screen-space distance from the pointer to the candidate session pill,
   * in pixels. */
  distancePx: number
  /** Instantaneous pointer speed, in pixels per second. */
  pointerSpeedPxPerSec: number
  /** Milliseconds since the last wheel or drag event (`Infinity` if none
   * yet this session). */
  msSinceLastWheelOrDrag: number
  /** Seconds elapsed since the previous gravity step — scales the pull so
   * it never doubles in strength on a 120Hz display (spike 011: "gravity is
   * suppressed while the user is moving the view and scaled by frame
   * time"). */
  frameDeltaSeconds: number
  /** The candidate session's own letter count (D-17: "more strongly for
   * bigger notes"). */
  letterCount: number
}

/** UI-SPEC "Side view read-back": gravity acts only within 48px, only below
 * 120px/s pointer speed, and only when no wheel or drag happened in the
 * last 150ms. */
export const GRAVITY_RADIUS_PX = 48
export const GRAVITY_MAX_POINTER_SPEED_PX_PER_SEC = 120
export const GRAVITY_SUPPRESS_MS = 150

/** Spike 011's own first-guess pull coefficient ("140px radius, 0.22 pull"
 * — the radius there is the spike's own exploratory value; this plan's own
 * radius is UI-SPEC's 48px above, per D-17's discretion-owned gravity
 * strength/hover-radius clause). Not yet tuned against a person's hand —
 * this plan's own Task 3 carries the human-check for that. */
const GRAVITY_K0 = 0.22

/**
 * Weight curve `k0 · clamp(log2(1 + letters) / 10, 0.2, 1)` (UI-SPEC "Side
 * view read-back"), so a bigger session pulls harder, clamped so neither an
 * empty session nor a very large one pulls outside the curve's own range.
 */
export function gravityWeight(letterCount: number): number {
  return GRAVITY_K0 * Math.min(1, Math.max(0.2, Math.log2(1 + Math.max(0, letterCount)) / 10))
}

/**
 * The fraction (0..1) of the remaining distance to ease the view centre
 * toward a candidate session this frame — a critically damped spring,
 * scaled by frame time so it behaves identically at any refresh rate (spike
 * 011). Returns exactly 0 whenever any suppression condition holds: beyond
 * the 48px radius, at or above 120px/s pointer speed, or within 150ms of a
 * wheel or drag — "there is no pull while moving freely" (D-17). The caller
 * (`ThreadOverlay.tsx`) applies the returned fraction to ease the view
 * centre toward the candidate's own `atSeconds`; this function never reads
 * or knows the view centre itself.
 */
export function gravityStep(input: GravityInput): number {
  if (input.distancePx > GRAVITY_RADIUS_PX) return 0
  if (input.pointerSpeedPxPerSec >= GRAVITY_MAX_POINTER_SPEED_PX_PER_SEC) return 0
  if (input.msSinceLastWheelOrDrag < GRAVITY_SUPPRESS_MS) return 0
  const proximity = 1 - input.distancePx / GRAVITY_RADIUS_PX
  const pull = proximity * proximity * gravityWeight(input.letterCount)
  // Normalized so the first-guess pull magnitude above is calibrated at
  // 60fps (frameDeltaSeconds ≈ 1/60); a slower or faster refresh rate scales
  // proportionally, per spike 011's own "scaled by frame time" rule.
  return Math.min(1, pull * Math.max(0, input.frameDeltaSeconds) * 60)
}

// ---------------------------------------------------------------------------
// Date scrubber: day <-> centre mapping (UI-SPEC "Gap and scrubber honesty")
// ---------------------------------------------------------------------------

export const MS_PER_DAY = 86_400_000

/** The absolute ms of the start of the UTC day containing `atMs` — the
 * scrubber's own one-tick-per-day grid. */
export function dayStartMs(atMs: number): number {
  return Math.floor(atMs / MS_PER_DAY) * MS_PER_DAY
}

/** The zero-based day index of `atMs`, relative to `firstDayMs` (itself
 * already a day-start, from `dayStartMs`). */
export function dayIndexOf(atMs: number, firstDayMs: number): number {
  return Math.floor((atMs - firstDayMs) / MS_PER_DAY)
}

/** The view centre (absolute ms) a scrubber drag/step to `dayIndex` should
 * move to — the middle of that day, so landing on a day centres the view on
 * it rather than on its very first millisecond. */
export function dayIndexToCenterMs(dayIndex: number, firstDayMs: number): number {
  return firstDayMs + dayIndex * MS_PER_DAY + MS_PER_DAY / 2
}

// ---------------------------------------------------------------------------
// Keyboard map (UI-SPEC "Keyboard map" — every navigation action has a key)
// ---------------------------------------------------------------------------

export type NavAction =
  | 'return-to-now'
  | 'prev-session'
  | 'next-session'
  | 'prev-marker'
  | 'next-marker'
  | 'zoom-in'
  | 'zoom-out'
  | 'pan-left'
  | 'pan-right'
  | 'home'
  | 'end'
  | 'open-focused'
  | 'toggle-separate-authors'

/**
 * Every side-view keyboard action this plan wires (UI-SPEC "Keyboard map"),
 * as a single lookup both the real `keydown` handler and this plan's own
 * `navigation.test.ts` read, so "every row is bound" is provable from one
 * table rather than asserted against two independently-written switch
 * statements. Arrow keys pan by 10% of the view width, Shift+arrow by 100%
 * — the caller reads `event.shiftKey` for that distinction, since the key
 * itself (`ArrowLeft`/`ArrowRight`) is the same physical key either way.
 * `Opt` (hold, author-underlay reveal) and `Cmd+Z` (ordinary editor undo)
 * are not navigation actions and are handled by their own owners elsewhere,
 * not through this table.
 */
export const NAV_KEYS: Record<string, NavAction> = {
  Escape: 'return-to-now',
  '[': 'prev-session',
  ']': 'next-session',
  ',': 'prev-marker',
  '.': 'next-marker',
  '+': 'zoom-in',
  '=': 'zoom-in', // the unshifted key sharing the '+' glyph on most layouts
  '-': 'zoom-out',
  ArrowLeft: 'pan-left',
  ArrowRight: 'pan-right',
  Home: 'home',
  End: 'end',
  Enter: 'open-focused',
  a: 'toggle-separate-authors',
  A: 'toggle-separate-authors',
}
