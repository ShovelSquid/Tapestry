/**
 * The move particles overlay for one note (Line Lab v2 wave 6).
 *
 * Runs only while the note is being dragged, and after the drop until the
 * last speck has faded, so a still note requests no frames. The specks are
 * drawn straight into one SVG group each frame rather than through React:
 * they live for under half a second and are never part of the note's state.
 */

import React, { useEffect, useRef } from 'react'
import { effectStrength, frameScheduler, readMotionSettings } from './motion'
import {
  createTracker,
  liveParticles,
  particleStreak,
  spawnParticles,
  trackMotion,
  trackerAtRest,
  tuningFromLook,
  type Particle,
} from './particles'

const SVG_NS = 'http://www.w3.org/2000/svg'

const SVG_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  overflow: 'visible',
  pointerEvents: 'none',
} as const

export interface MoveParticlesProps {
  /** The note's position, world px (it moves while dragged). */
  x: number
  y: number
  /** The card's own size, px. */
  w: number
  h: number
  zoom: number
  dragging: boolean
}

export function MoveParticles({ x, y, w, h, zoom, dragging }: MoveParticlesProps): React.ReactElement {
  const gRef = useRef<SVGGElement>(null)
  const latest = useRef({ x, y, w, h, zoom, dragging })
  latest.current = { x, y, w, h, zoom, dragging }

  // The loop outlives the drag: the drop is itself a velocity change, and
  // specks already thrown finish their flight. A new drag before the last
  // one's specks land carries on in the same loop.
  const loopRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!dragging || loopRef.current) return
    const tuning = tuningFromLook(effectStrength(readMotionSettings(), 'particles'))
    if (tuning.maxCount <= 0) return
    const tracker = createTracker(latest.current.x, latest.current.y)
    let particles: Particle[] = []

    const draw = (nowMs: number): void => {
      const g = gRef.current
      if (!g) return
      while (g.firstChild) g.removeChild(g.firstChild)
      const z = latest.current.zoom || 1
      for (const p of particles) {
        const s = particleStreak(p, nowMs, z)
        if (!s) continue
        const line = document.createElementNS(SVG_NS, 'line')
        line.setAttribute('x1', String(s.x1))
        line.setAttribute('y1', String(s.y1))
        line.setAttribute('x2', String(s.x2))
        line.setAttribute('y2', String(s.y2))
        line.setAttribute('stroke-opacity', s.alpha.toFixed(3))
        line.setAttribute('stroke-width', String(1.5 / z))
        g.appendChild(line)
      }
    }

    const unsubscribe = frameScheduler().subscribe((nowMs, dtMs) => {
      const cur = latest.current
      const kick = trackMotion(tracker, cur.x, cur.y, cur.zoom, nowMs, dtMs, tuning)
      if (kick) particles = particles.concat(spawnParticles(cur.w, cur.h, kick, nowMs))
      particles = liveParticles(particles, nowMs)
      draw(nowMs)
      if (!cur.dragging && particles.length === 0 && trackerAtRest(tracker)) {
        unsubscribe()
        loopRef.current = null
      }
    })
    loopRef.current = unsubscribe
  }, [dragging])

  useEffect(
    () => () => {
      loopRef.current?.()
      loopRef.current = null
    },
    [],
  )

  return (
    <svg className="tap-move-particles" style={SVG_STYLE} aria-hidden="true">
      <g ref={gRef} />
    </svg>
  )
}
