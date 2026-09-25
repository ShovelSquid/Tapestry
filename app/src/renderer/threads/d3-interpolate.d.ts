/**
 * Minimal ambient types for `d3-interpolate`'s `interpolateZoom` (RESEARCH
 * "Standard Stack": d3-interpolate@3.0.1, approved, no `@types/` package
 * pulled in). The published package ships no bundled `.d.ts` and
 * DefinitelyTyped's `@types/d3-interpolate` is not part of this plan's
 * package legitimacy audit, so this file declares only the one export
 * `navigation.ts` actually uses, kept in lockstep with
 * `node_modules/d3-interpolate/src/zoom.js`'s own JSDoc:
 * `zoom(p0, p1)` returns an interpolator `i(t)` with `i.duration` attached
 * (the recommended transition length, derived from the path's own length).
 */
declare module 'd3-interpolate' {
  /** `[ux, uy, w]` — a 2D centre plus a viewport width, in the caller's own
   * units (`navigation.ts` always passes `uy = 0`, since the side view only
   * zooms/pans along one axis, thread time). */
  export type ZoomView = readonly [number, number, number]

  export interface ZoomInterpolator {
    (t: number): ZoomView
    /** The path's own recommended duration; not necessarily positive (see
     * `node_modules/d3-interpolate/src/zoom.js`'s `S`) — callers should take
     * `Math.abs` and clamp before using it as a transition length in ms. */
    duration: number
  }

  export function interpolateZoom(a: ZoomView, b: ZoomView): ZoomInterpolator
}
