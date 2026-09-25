/**
 * Rifling and text bob (Line Lab v2 wave 6, spec §7).
 *
 * Moving the cursor over the canvas nudges the notes near it a little away
 * from it, as if riffling through them; when the cursor stops they settle
 * back. The text of the note under the cursor shifts so little it's barely
 * noticed. Both start on at low strength (motion.ts); whether writers get
 * them off by default is gate 4.
 *
 * The nudge is a CSS `translate` on the card, separate from the bob's
 * `transform`, so the two never fight, and it never touches a position:
 * nothing here reaches the `.tree`. A note that is being dragged or edited
 * is left alone, so a writer's text never moves under them.
 *
 * The maths is pure and tested; `registerRifle` is the one DOM piece. It
 * listens to the pointer once for every note and runs the shared frame
 * loop only while something is drifting, so a still cursor costs nothing.
 */

import { effectStrength, frameScheduler, readMotionSettings, subscribeMotionSettings } from './motion'

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Vec {
  x: number
  y: number
}

export const RIFLE = Object.freeze({
  /** How far from a note's edge the cursor still nudges it, screen px. */
  radiusPx: 140,
  /** The largest nudge at full strength, screen px. */
  maxPx: 4,
  /** The largest text shift at full strength, screen px. */
  textMaxPx: 1.2,
  /** After the cursor last moved, how long things keep drifting before they settle. */
  holdMs: 220,
  /** Time constant of the drift and the settle. */
  easeMs: 140,
})

export function nearestPointOnRect(r: RectLike, px: number, py: number): Vec {
  return { x: Math.max(r.left, Math.min(r.right, px)), y: Math.max(r.top, Math.min(r.bottom, py)) }
}

export function insideRect(r: RectLike, px: number, py: number): boolean {
  return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom
}

/**
 * Where a note wants to drift, screen px: away from the cursor, strongest at
 * its edge and nothing past `radiusPx`. A cursor inside the note leaves it
 * where it is (the note has been entered, not brushed past).
 */
export function rifleTarget(r: RectLike, px: number, py: number, strength: number): Vec {
  if (strength <= 0 || insideRect(r, px, py)) return { x: 0, y: 0 }
  const n = nearestPointOnRect(r, px, py)
  const dx = n.x - px
  const dy = n.y - py
  const d = Math.hypot(dx, dy)
  if (d <= 0 || d >= RIFLE.radiusPx) return { x: 0, y: 0 }
  const k = 1 - d / RIFLE.radiusPx
  const m = RIFLE.maxPx * Math.min(1, strength) * k * k
  return { x: (dx / d) * m, y: (dy / d) * m }
}

/**
 * The text's shift, screen px, for a cursor inside the note: away from the
 * cursor, nothing with the cursor at the middle and the most at an edge.
 * Outside the note, none.
 */
export function textBobTarget(r: RectLike, px: number, py: number, strength: number): Vec {
  if (strength <= 0 || !insideRect(r, px, py)) return { x: 0, y: 0 }
  const hw = Math.max(1, (r.right - r.left) / 2)
  const hh = Math.max(1, (r.bottom - r.top) / 2)
  const ux = ((r.left + r.right) / 2 - px) / hw
  const uy = ((r.top + r.bottom) / 2 - py) / hh
  const m = RIFLE.textMaxPx * Math.min(1, strength)
  // Mostly up and down: a bob, not a slide.
  return { x: ux * m * 0.5, y: uy * m }
}

/** Ease `cur` toward `target` over `dtMs`. */
export function drift(cur: Vec, target: Vec, dtMs: number): Vec {
  const a = 1 - Math.exp(-Math.max(0, dtMs) / RIFLE.easeMs)
  return { x: cur.x + (target.x - cur.x) * a, y: cur.y + (target.y - cur.y) * a }
}

/** Close enough to rest that the loop can stop and the style can clear. */
export function atRest(v: Vec): boolean {
  return Math.abs(v.x) < 0.01 && Math.abs(v.y) < 0.01
}

// ---------- the DOM piece ----------

export interface RifleItem {
  /** The card that drifts. */
  el: HTMLElement
  /** Its text, which bobs; null for none. */
  text: () => HTMLElement | null
  /** A screen-px offset in the card's own px (undoes zoom and roll). */
  toLocal: (dx: number, dy: number) => Vec
  /** False while dragged or edited: left exactly where it is. */
  enabled: () => boolean
}

interface Live {
  item: RifleItem
  /** Current offsets, screen px. */
  card: Vec
  text: Vec
}

const items = new Set<Live>()
const cursor = { x: 0, y: 0, lastMove: -1e9, pressed: false, present: false }
let loop: (() => void) | null = null
let detach: (() => void) | null = null

function write(live: Live): void {
  const c = atRest(live.card) ? null : live.item.toLocal(live.card.x, live.card.y)
  live.item.el.style.translate = c ? `${c.x.toFixed(2)}px ${c.y.toFixed(2)}px` : ''
  const textEl = live.item.text()
  if (textEl) {
    const t = atRest(live.text) ? null : live.item.toLocal(live.text.x, live.text.y)
    textEl.style.translate = t ? `${t.x.toFixed(2)}px ${t.y.toFixed(2)}px` : ''
  }
}

function frame(nowMs: number, dtMs: number): void {
  const settings = readMotionSettings()
  const rifle = effectStrength(settings, 'rifling')
  const bob = effectStrength(settings, 'textBob')
  const active = cursor.present && !cursor.pressed && nowMs - cursor.lastMove < RIFLE.holdMs
  const zero = { x: 0, y: 0 }

  // Read every rect first, then write, so one frame lays out once.
  const lives = [...items]
  const rects = lives.map((l) => (active && l.item.enabled() ? l.item.el.getBoundingClientRect() : null))
  let moving = false
  lives.forEach((live, i) => {
    const r = rects[i]
    // The rect already carries this frame's nudge; take it back out.
    const base = r
      ? { left: r.left - live.card.x, right: r.right - live.card.x, top: r.top - live.card.y, bottom: r.bottom - live.card.y }
      : null
    const tCard = base ? rifleTarget(base, cursor.x, cursor.y, rifle) : zero
    const tText = base ? textBobTarget(base, cursor.x, cursor.y, bob) : zero
    // An effect switched off, or a note taken in hand, goes still at once.
    live.card = rifle > 0 && live.item.enabled() ? drift(live.card, tCard, dtMs) : zero
    live.text = bob > 0 && live.item.enabled() ? drift(live.text, tText, dtMs) : zero
    if (atRest(live.card) && atRest(tCard)) live.card = zero
    if (atRest(live.text) && atRest(tText)) live.text = zero
    write(live)
    if (!atRest(live.card) || !atRest(live.text) || !atRest(tCard) || !atRest(tText)) moving = true
  })
  if (!moving && !active) stopLoop()
}

function startLoop(): void {
  if (loop) return
  loop = frameScheduler().subscribe(frame)
}

function stopLoop(): void {
  loop?.()
  loop = null
}

function wantsLoop(): boolean {
  const s = readMotionSettings()
  return effectStrength(s, 'rifling') > 0 || effectStrength(s, 'textBob') > 0
}

function attach(): void {
  const onMove = (e: PointerEvent): void => {
    cursor.x = e.clientX
    cursor.y = e.clientY
    cursor.pressed = e.buttons !== 0
    cursor.present = true
    cursor.lastMove = performance.now()
    if (wantsLoop()) startLoop()
  }
  const onLeave = (): void => {
    cursor.present = false
  }
  // Turning an effect off mid-drift settles everything at once.
  const offSettings = subscribeMotionSettings(() => {
    if (!wantsLoop()) {
      for (const live of items) {
        live.card = { x: 0, y: 0 }
        live.text = { x: 0, y: 0 }
        write(live)
      }
      stopLoop()
    }
  })
  document.addEventListener('pointermove', onMove, { passive: true, capture: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
  detach = () => {
    document.removeEventListener('pointermove', onMove, { capture: true })
    document.documentElement.removeEventListener('pointerleave', onLeave)
    offSettings()
  }
}

/** Let a note drift. Returns the function that stops it and clears its styles. */
export function registerRifle(item: RifleItem): () => void {
  const live: Live = { item, card: { x: 0, y: 0 }, text: { x: 0, y: 0 } }
  items.add(live)
  if (!detach) attach()
  return () => {
    items.delete(live)
    live.card = { x: 0, y: 0 }
    live.text = { x: 0, y: 0 }
    write(live)
    if (items.size === 0) {
      stopLoop()
      detach?.()
      detach = null
    }
  }
}
