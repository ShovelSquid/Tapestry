/**
 * The note look's tuned numbers, in one place (Line Lab v2, Part 2 wave 0).
 *
 * Source of truth: Kaelen's JSON in `~/Tree/Design/Index First Pass
 * Notes.md` (2026-09-25), tuned in Line Lab and copied into "Spec - Notes,
 * Lines and Motion" §2b. The `line`, `selectionWaves`, `motion` and
 * `collapse` groups mirror that JSON key for key, so a new export from Line
 * Lab can be diffed against this file directly. The `detail` group holds
 * the smaller constants Line Lab's code uses that Kaelen didn't tune
 * (red dot timing, particle kick, form crossfade).
 *
 * This is the only place these numbers live in code. Colours are not here:
 * they are `--tap-*` tokens in App.css. Everything in this file is
 * render-only; none of it reaches the `.tree` or the kernel.
 */

export interface LookValues {
  readonly line: {
    /** Line weight at 100% zoom, in world px. Static: scales with zoom. */
    readonly weightPx: number
    readonly wobblePx: number
    readonly wobbleBumpsPerLoop: number
    readonly widthVariationPct: number
    readonly cornerSwellPct: number
    readonly edgeGrainPct: number
  }
  readonly selectionWaves: {
    readonly heightPx: number
    readonly wavesPerLoop: number
    /** Loops per second the wave travels around the outline. */
    readonly speed: number
    readonly counterWave: boolean
  }
  readonly motion: {
    /** Scale keyframes after an implicit starting 1, played over `bobMs`. */
    readonly bobKeyframes: readonly number[]
    readonly bobMs: number
    readonly selectionGrowMs: number
    readonly hoverBloomMs: number
    /** Most specks one velocity change throws. */
    readonly moveParticles: number
  }
  readonly collapse: {
    /** A note narrower than this on screen draws as a circle. */
    readonly circleBelowPx: number
    /** A note narrower than this on screen draws as a node dot. */
    readonly dotBelowPx: number
  }
  readonly detail: {
    /** Red delete dot grow and shrink, each way (Line Lab task 2). */
    readonly deleteDotMs: number
    /** Velocity change, in screen px per ms, that throws particles. */
    readonly particleKick: number
    readonly particleCooldownMs: number
    /** Note ↔ circle ↔ dot crossfade. */
    readonly formCrossfadeMs: number
    /** The note flipping to its settings and back, each way. */
    readonly noteFlipMs: number
  }
}

export const LOOK: LookValues = Object.freeze({
  line: Object.freeze({
    weightPx: 1,
    wobblePx: 1.4,
    wobbleBumpsPerLoop: 3,
    widthVariationPct: 14,
    cornerSwellPct: 46,
    edgeGrainPct: 0,
  }),
  selectionWaves: Object.freeze({
    heightPx: 1.2,
    wavesPerLoop: 2,
    speed: 0.35,
    counterWave: true,
  }),
  motion: Object.freeze({
    bobKeyframes: Object.freeze([1.01, 0.97, 1.015, 0.995, 1]),
    bobMs: 350,
    selectionGrowMs: 670,
    hoverBloomMs: 770,
    moveParticles: 3,
  }),
  collapse: Object.freeze({
    circleBelowPx: 110,
    dotBelowPx: 28,
  }),
  detail: Object.freeze({
    deleteDotMs: 180,
    particleKick: 0.45,
    particleCooldownMs: 120,
    formCrossfadeMs: 220,
    noteFlipMs: 260,
  }),
})
