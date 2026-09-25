/**
 * The D-11/D-13 pause slowdown curve, as a pure function of real seconds.
 *
 * D-11: while the typer is open and typing stops, dots keep streaming at
 * 60/s, then slow — about 30/s after roughly 10s, about 10/s at roughly
 * 30s, and 1/s after a minute. The rate holds at 1/s until the time-out.
 * D-12: the line travels at constant speed during a pause; only the dots
 * get sparser — that is a property of how the ribbon draws distance
 * (SPEED × elapsed seconds, always), never of this module.
 * D-13: dot rates follow real seconds, not the display's refresh rate, so a
 * 120Hz display draws the same line a 60Hz display does. Every function
 * here takes "seconds since the last keystroke" as its only time input —
 * never a frame count or a frame delta — which is what makes that true.
 *
 * Pure TypeScript: no Electron, Node or DOM import, so main, renderer,
 * vitest and the stage's shader-uniform setup all agree on the same curve
 * (the same discipline grammar.ts and settings.ts already follow).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One step of the D-11 curve: from `afterSeconds` since the last keystroke
 * onward, the dot rate becomes `ratePerSecond`, until the next breakpoint
 * (or, for the last one, until the time-out). Breakpoints are kept sorted
 * ascending by `afterSeconds`. */
export interface SlowdownBreakpoint {
  afterSeconds: number
  ratePerSecond: number
}

/** A parsed D-11/D-13 curve: a sorted list of breakpoints. Before the first
 * breakpoint (or when the curve is empty) the rate is `HZ` — the ordinary
 * while-typing dot rate. */
export type SlowdownCurve = readonly SlowdownBreakpoint[]

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Dots per second while typing (D-11 baseline; matches the stage's `HZ`). */
export const HZ = 60

/** The `"<afterSeconds>:<rate> ..."` property form (settings.ts's
 * `THREAD_DEFAULT_SLOWDOWN`, kept here as the string literal the grammar
 * spec quotes, so `parseSlowdown` has a canonical worked example). */
const DEFAULT_SLOWDOWN_TEXT = '10:30 30:10 60:1'

// ---------------------------------------------------------------------------
// parseSlowdown
// ---------------------------------------------------------------------------

/**
 * Parses the per-thread slowdown property text, `"<afterSeconds>:<rate>
 * ..."` (space-separated breakpoints, D-11/D-13's stored form), into a
 * `SlowdownCurve` sorted ascending by `afterSeconds`.
 *
 * Throws on a malformed token rather than guessing at intent, matching
 * grammar.ts's own discipline for a malformed `thread.log` value.
 */
export function parseSlowdown(text: string): SlowdownCurve {
  const tokens = text.trim().split(/\s+/).filter((token) => token.length > 0)
  const breakpoints: SlowdownBreakpoint[] = tokens.map((token) => {
    const colon = token.indexOf(':')
    if (colon === -1) {
      throw new Error(`malformed slowdown breakpoint (expected "<seconds>:<rate>"): ${token}`)
    }
    const afterSeconds = Number(token.slice(0, colon))
    const ratePerSecond = Number(token.slice(colon + 1))
    if (!Number.isFinite(afterSeconds) || !Number.isFinite(ratePerSecond)) {
      throw new Error(`malformed slowdown breakpoint (non-numeric): ${token}`)
    }
    return { afterSeconds, ratePerSecond }
  })
  return breakpoints.slice().sort((a, b) => a.afterSeconds - b.afterSeconds)
}

/** The D-11 curve's rough defaults, already parsed: ~30/s after ~10s,
 * ~10/s at ~30s, 1/s after a minute, held at 1/s until the time-out. */
export const DEFAULT_SLOWDOWN: SlowdownCurve = parseSlowdown(DEFAULT_SLOWDOWN_TEXT)

// ---------------------------------------------------------------------------
// dotRateAt
// ---------------------------------------------------------------------------

/**
 * The instantaneous dot rate (dots per second) at `secondsSinceLastInput`
 * — a real-seconds step function (D-13). Holds at `HZ` until the curve's
 * first breakpoint, then steps to each later breakpoint's rate in turn,
 * holding at the last breakpoint's rate until the caller's own time-out
 * logic ends the pause (D-11). `secondsSinceLastInput` is always measured
 * from wall-clock time elapsed since the last keystroke, never from a
 * frame count, so this function returns the same value regardless of the
 * caller's refresh rate.
 */
export function dotRateAt(curve: SlowdownCurve, secondsSinceLastInput: number): number {
  let rate = HZ
  for (const breakpoint of curve) {
    if (secondsSinceLastInput >= breakpoint.afterSeconds) {
      rate = breakpoint.ratePerSecond
    } else {
      break
    }
  }
  return rate
}
