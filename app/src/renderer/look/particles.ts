/**
 * Move particles (Line Lab v2 task 5, Part 2 wave 6).
 *
 * Dragging a note throws a few wind-like specks when its velocity changes,
 * in the direction of the change, from the two corners that face it.
 * Starting and stopping are only changes from and to zero. Velocity is
 * smoothed over a few frames, so a steady drag or a gentle curve throws
 * none; the count scales with how sharp the change is, up to the "move
 * particles" value, with a cooldown so a shaky drag doesn't spray.
 *
 * This is Line Lab's `trackMotion` / `spawnParticles` / `drawParticles`
 * made pure: positions are in the card's own px, speeds in screen px per
 * ms (the card's px times the zoom), and the random source is passed in so
 * tests are repeatable. Nothing here reaches the `.tree`.
 */

import { LOOK } from './values'

export interface MotionTracker {
  /** Last position, card px. */
  x: number
  y: number
  /** Smoothed velocity and the slower reference it is compared with, screen px/ms. */
  vx: number
  vy: number
  rx: number
  ry: number
  /** The sharpest change seen since the kick started, until it passes. */
  peak: { d: number; dx: number; dy: number; at: number } | null
  lastEmit: number
}

export interface Kick {
  /** Direction of the velocity change (not normalised). */
  dx: number
  dy: number
  count: number
}

export interface MotionTuning {
  /** Velocity change, screen px per ms, that starts a kick. */
  kick: number
  cooldownMs: number
  /** Most specks one kick throws. */
  maxCount: number
}

export function tuningFromLook(strength = 1): MotionTuning {
  return {
    kick: LOOK.detail.particleKick,
    cooldownMs: LOOK.detail.particleCooldownMs,
    maxCount: Math.round(LOOK.motion.moveParticles * Math.max(0, Math.min(1, strength))),
  }
}

export function createTracker(x: number, y: number): MotionTracker {
  return { x, y, vx: 0, vy: 0, rx: 0, ry: 0, peak: null, lastEmit: -1e9 }
}

/**
 * Feed one frame: the card is at (x, y) at `nowMs`, `dtMs` after the last
 * frame. Returns a kick once the sharpest part of a velocity change has
 * passed (it falls off by 15% or 90 ms go by), otherwise null.
 */
export function trackMotion(
  m: MotionTracker,
  x: number,
  y: number,
  zoom: number,
  nowMs: number,
  dtMs: number,
  tuning: MotionTuning,
): Kick | null {
  const vx = dtMs > 0 ? ((x - m.x) / dtMs) * zoom : 0
  const vy = dtMs > 0 ? ((y - m.y) / dtMs) * zoom : 0
  m.x = x
  m.y = y
  const a = 1 - Math.exp(-dtMs / 70)
  m.vx += (vx - m.vx) * a
  m.vy += (vy - m.vy) * a
  const dx = m.vx - m.rx
  const dy = m.vy - m.ry
  const d = Math.hypot(dx, dy)
  if (m.peak) {
    if (d > m.peak.d) m.peak = { d, dx, dy, at: m.peak.at }
    if (d < m.peak.d * 0.85 || nowMs - m.peak.at > 90) {
      const count = Math.min(tuning.maxCount, Math.round(m.peak.d / tuning.kick))
      const kick = { dx: m.peak.dx, dy: m.peak.dy, count }
      m.peak = null
      m.rx = m.vx
      m.ry = m.vy
      m.lastEmit = nowMs
      return count > 0 ? kick : null
    }
    return null
  }
  if (d > tuning.kick && nowMs - m.lastEmit > tuning.cooldownMs) {
    m.peak = { d, dx, dy, at: nowMs }
    return null
  }
  const b = 1 - Math.exp(-dtMs / 250)
  m.rx += (m.vx - m.rx) * b
  m.ry += (m.vy - m.ry) * b
  return null
}

/** Nothing moving and nothing pending: the frame loop can stop. */
export function trackerAtRest(m: MotionTracker): boolean {
  return m.peak === null && Math.hypot(m.vx, m.vy) < 0.005 && Math.hypot(m.rx, m.ry) < 0.005
}

export interface Particle {
  /** Origin corner, card px. */
  x: number
  y: number
  /** Unit direction of flight. */
  vx: number
  vy: number
  born: number
  life: number
}

/**
 * Specks for one kick, from the two corners of a `w` × `h` card that face
 * the change, alternating. The first corners are the ones furthest along
 * the direction.
 */
export function spawnParticles(
  w: number,
  h: number,
  kick: Kick,
  nowMs: number,
  random: () => number = Math.random,
): Particle[] {
  if (kick.count <= 0) return []
  const len = Math.hypot(kick.dx, kick.dy) || 1
  const dirx = kick.dx / len
  const diry = kick.dy / len
  const cx = w / 2
  const cy = h / 2
  const corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ].sort((a, b) => (b.x - cx) * dirx + (b.y - cy) * diry - ((a.x - cx) * dirx + (a.y - cy) * diry))
  const out: Particle[] = []
  for (let i = 0; i < kick.count; i++) {
    const c = corners[i % 2]
    const sp = (random() - 0.5) * 0.6
    out.push({ x: c.x, y: c.y, vx: dirx + sp * diry, vy: diry - sp * dirx, born: nowMs + i * 25, life: 340 + random() * 120 })
  }
  return out
}

export interface Streak {
  x1: number
  y1: number
  x2: number
  y2: number
  alpha: number
}

/**
 * Where a speck is drawn at `nowMs`, in card px: a short streak that flies
 * out and fades. Distances are screen px divided by `zoom`, so the specks
 * look the same size at any zoom. Null before it is born or after it dies.
 */
export function particleStreak(p: Particle, nowMs: number, zoom: number): Streak | null {
  const t = (nowMs - p.born) / p.life
  if (!(t >= 0 && t < 1)) return null
  const z = zoom > 0 ? zoom : 1
  const d = (10 + t * 26) / z
  const x1 = p.x + p.vx * d
  const y1 = p.y + p.vy * d
  return { x1, y1, x2: x1 + (p.vx * 8) / z, y2: y1 + (p.vy * 8) / z, alpha: 0.5 * (1 - t) }
}

export function liveParticles(ps: readonly Particle[], nowMs: number): Particle[] {
  return ps.filter((p) => nowMs - p.born < p.life)
}
