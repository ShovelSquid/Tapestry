/**
 * The motion settings button and panel (Line Lab v2 wave 6, spec §7).
 *
 * Every motion has a strength slider and an off switch, kept per person in
 * localStorage (motion.ts), never in the `.tree`. The button sits in the
 * forest bar and is meant to be fun to touch: its glyph is a wave whose
 * height is how much motion the app has on, so turning everything off
 * flattens it to a still line, and hovering it wiggles.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  MOTION_EFFECTS,
  MOTION_LABELS,
  allStill,
  effectStrength,
  motionCssVars,
  setMotionSettings,
  withAll,
  withEffect,
  type MotionSettings,
} from './motion'
import { useMotionSettings } from './useMotionSettings'

/** Mean strength over every effect, 0 when all are off. */
export function motionLevel(settings: MotionSettings): number {
  let sum = 0
  for (const e of MOTION_EFFECTS) sum += effectStrength(settings, e)
  return sum / MOTION_EFFECTS.length
}

/** The glyph's wave: two humps across 20 px, `level` 0..1 high. */
export function waveGlyphPath(level: number): string {
  const a = 5 * Math.max(0, Math.min(1, level))
  const f = (n: number): string => (Math.round(n * 100) / 100).toString()
  return `M2 10 C5 ${f(10 - a)} 7 ${f(10 - a)} 10 10 S15 ${f(10 + a)} 18 10`
}

/** Keeps the stylesheet's motion variables in step with the settings. */
export function useMotionCss(): void {
  const settings = useMotionSettings()
  useEffect(() => {
    const root = document.documentElement
    for (const [k, v] of Object.entries(motionCssVars(settings))) root.style.setProperty(k, v)
  }, [settings])
}

export function MotionButton(): React.ReactElement {
  const settings = useMotionSettings()
  useMotionCss()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  const still = allStill(settings)
  return (
    <span className="tapestry-forest-popover-anchor">
      <button
        ref={buttonRef}
        type="button"
        className={'tapestry-forest-button tap-motion-button' + (still ? ' tap-motion-button--still' : '')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Motion settings"
        onClick={() => setOpen((o) => !o)}
      >
        <svg className="tap-motion-glyph" width={20} height={20} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d={waveGlyphPath(motionLevel(settings))} />
        </svg>
        Motion
      </button>
      {open && (
        <div ref={panelRef} className="tap-motion-panel" role="dialog" aria-label="Motion settings" onKeyDown={onKeyDown}>
          <div className="tap-motion-panel-head">
            <span>Motion</span>
            <button
              type="button"
              className="tapestry-button--secondary"
              onClick={() => setMotionSettings(withAll(settings, still))}
            >
              {still ? 'All on' : 'All off'}
            </button>
          </div>
          {MOTION_EFFECTS.map((e) => {
            const s = settings[e]
            const id = `tap-motion-${e}`
            return (
              <div key={e} className="tap-motion-row">
                <input
                  id={id}
                  type="checkbox"
                  checked={s.on}
                  onChange={(ev) => setMotionSettings(withEffect(settings, e, { on: ev.target.checked }))}
                />
                <label htmlFor={id}>{MOTION_LABELS[e]}</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(s.strength * 100)}
                  disabled={!s.on}
                  aria-label={`${MOTION_LABELS[e]} strength`}
                  onChange={(ev) => setMotionSettings(withEffect(settings, e, { strength: Number(ev.target.value) / 100 }))}
                />
              </div>
            )
          })}
        </div>
      )}
    </span>
  )
}
