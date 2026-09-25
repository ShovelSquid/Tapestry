/**
 * The motion core for the note look (Line Lab v2, Part 2 wave 0).
 *
 * Four pieces, all render-only (nothing here reaches the `.tree`):
 *
 * - Easing helpers, the same curves Line Lab uses.
 * - `Amount`: a 0→1 value that moves toward a target at a fixed rate, read
 *   through an easing. Every hover, grow and shrink-back uses one, so a
 *   quick in-and-out reverses from where it is instead of snapping (Line
 *   Lab task 2).
 * - `bobScale`: keyframe playback for the selection bob.
 * - `createScheduler`: one requestAnimationFrame loop shared by every
 *   animated thing, running only while something is subscribed.
 *
 * Motion settings are per person, like camera state: a strength and an
 * off switch per effect, kept in localStorage and never sent to main. The
 * OS "reduce motion" preference starts every effect at off; after that the
 * person's saved choice wins. An effect that is off (or at strength 0)
 * jumps straight to its end state, so turning everything off leaves a
 * still app.
 */

export const MOTION_EFFECTS = [
  'hoverBloom',
  'selectionGrow',
  'selectionWave',
  'bob',
  'deleteDot',
  'particles',
  'collapseFade',
  'rifling',
  'textBob',
  'buttonSwell',
] as const
export type MotionEffect = (typeof MOTION_EFFECTS)[number]

export interface EffectSetting {
  readonly on: boolean
  /** 0..1, scales the effect's size (not its duration). */
  readonly strength: number
}
export type MotionSettings = Readonly<Record<MotionEffect, EffectSetting>>

/** Rifling and text bob start on at low strength, as the spec says (gate 4). */
const LOW_STRENGTH: ReadonlySet<MotionEffect> = new Set(['rifling', 'textBob'])
const LOW = 0.3

export function defaultMotionSettings(reduceMotion: boolean): MotionSettings {
  const out = {} as Record<MotionEffect, EffectSetting>
  for (const e of MOTION_EFFECTS) {
    out[e] = { on: !reduceMotion, strength: LOW_STRENGTH.has(e) ? LOW : 1 }
  }
  return out
}

/** How strongly an effect runs right now: 0 when it's off. */
export function effectStrength(settings: MotionSettings, effect: MotionEffect): number {
  const s = settings[effect]
  return s.on ? clamp01(s.strength) : 0
}

export const MOTION_STORAGE_KEY = 'tapestry.motion.v1'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Saved settings merged over the defaults. Unknown effects in storage are
 * dropped and missing ones take their default, so adding an effect later
 * doesn't need a storage bump.
 */
export function loadMotionSettings(storage: StorageLike | null, reduceMotion: boolean): MotionSettings {
  const base = defaultMotionSettings(reduceMotion)
  if (!storage) return base
  let saved: unknown
  try {
    saved = JSON.parse(storage.getItem(MOTION_STORAGE_KEY) ?? 'null')
  } catch {
    return base
  }
  if (!saved || typeof saved !== 'object') return base
  const out = { ...base } as Record<MotionEffect, EffectSetting>
  for (const e of MOTION_EFFECTS) {
    const v = (saved as Record<string, unknown>)[e]
    if (!v || typeof v !== 'object') continue
    const { on, strength } = v as { on?: unknown; strength?: unknown }
    out[e] = {
      on: typeof on === 'boolean' ? on : base[e].on,
      strength: typeof strength === 'number' && Number.isFinite(strength) ? clamp01(strength) : base[e].strength,
    }
  }
  return out
}

export function saveMotionSettings(storage: StorageLike | null, settings: MotionSettings): void {
  if (!storage) return
  try {
    storage.setItem(MOTION_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage full or blocked: the settings still hold for this session.
  }
}

/** The renderer's own settings, read once from localStorage and the OS. */
export function readMotionSettings(): MotionSettings {
  if (typeof window === 'undefined') return defaultMotionSettings(false)
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  return loadMotionSettings(window.localStorage, reduce)
}

// ---------- easing ----------

export function clamp01(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t
}

/** Line Lab's `ease`: fast out, soft landing. */
export function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t)
  return 1 - u * u * u
}

/** Same curve both ways, for amounts that reverse (the red dot). */
export function smoothstep(t: number): number {
  const u = clamp01(t)
  return u * u * (3 - 2 * u)
}

/** Move `cur` toward `target` by `dt / durationMs`, never past it. */
export function approach(cur: number, target: number, dtMs: number, durationMs: number): number {
  const step = dtMs / Math.max(1, durationMs)
  return target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step)
}

// ---------- amounts ----------

export type Easing = (t: number) => number

/**
 * A 0→1 amount that eases toward a target. `raw` moves linearly; `value`
 * is `raw` through the easing, so reversing mid-way follows the same curve
 * back. At strength 0 it jumps to the target.
 */
export class Amount {
  raw: number
  target: number

  constructor(
    readonly durationMs: number,
    readonly easing: Easing = smoothstep,
    initial = 0,
  ) {
    this.raw = clamp01(initial)
    this.target = this.raw
  }

  set(target: number): void {
    this.target = clamp01(target)
  }

  /** Advance by `dtMs`. Returns true while still moving. */
  step(dtMs: number, strength = 1): boolean {
    if (strength <= 0) this.raw = this.target
    else this.raw = approach(this.raw, this.target, dtMs, this.durationMs)
    return this.raw !== this.target
  }

  get value(): number {
    return this.easing(this.raw)
  }

  get settled(): boolean {
    return this.raw === this.target
  }
}

// ---------- bob ----------

/**
 * Scale at `elapsedMs` into a bob: from 1 through each keyframe, cosine
 * eased between them (Line Lab's `bobScale`). Outside the bob, 1. The
 * strength scales how far the bob strays from 1.
 */
export function bobScale(
  keyframes: readonly number[],
  durationMs: number,
  elapsedMs: number,
  strength = 1,
): number {
  if (keyframes.length < 1 || durationMs <= 0 || strength <= 0) return 1
  const t = elapsedMs / durationMs
  if (!(t >= 0 && t < 1)) return 1
  const pts = [1, ...keyframes]
  const f = t * (pts.length - 1)
  const i = Math.floor(f)
  const u = f - i
  const s = (1 - Math.cos(Math.PI * u)) / 2
  const a = pts[i]
  const b = pts[Math.min(i + 1, pts.length - 1)]
  return 1 + (a + (b - a) * s - 1) * clamp01(strength)
}

// ---------- scheduler ----------

export type FrameCallback = (nowMs: number, dtMs: number) => void

export interface FrameSource {
  request(cb: (nowMs: number) => void): number
  cancel(handle: number): void
}

export interface Scheduler {
  /** Call `cb` every frame until the returned function is called. */
  subscribe(cb: FrameCallback): () => void
  readonly running: boolean
}

/** Longest frame step handed out, so a background tab doesn't jump. */
export const MAX_FRAME_DT_MS = 100

/**
 * One frame loop for every animated thing. It starts on the first
 * subscriber and stops when the last one leaves, so a still app requests
 * no frames at all.
 */
export function createScheduler(source: FrameSource): Scheduler {
  const subs = new Set<FrameCallback>()
  let handle: number | null = null
  let last: number | null = null

  const tick = (now: number): void => {
    handle = null
    const dt = last === null ? 0 : Math.max(0, Math.min(MAX_FRAME_DT_MS, now - last))
    last = now
    for (const cb of [...subs]) {
      if (subs.has(cb)) cb(now, dt)
    }
    if (subs.size > 0) handle = source.request(tick)
    else last = null
  }

  return {
    subscribe(cb) {
      subs.add(cb)
      if (handle === null) handle = source.request(tick)
      return () => {
        subs.delete(cb)
        if (subs.size === 0 && handle !== null) {
          source.cancel(handle)
          handle = null
          last = null
        }
      }
    },
    get running() {
      return handle !== null
    },
  }
}

let shared: Scheduler | null = null

/** The renderer's one scheduler, on requestAnimationFrame. */
export function frameScheduler(): Scheduler {
  if (!shared) {
    shared = createScheduler({
      request: (cb) => window.requestAnimationFrame(cb),
      cancel: (h) => window.cancelAnimationFrame(h),
    })
  }
  return shared
}
