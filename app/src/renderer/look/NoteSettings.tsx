/**
 * `<NoteSettings>`: the back of a note (Line Lab v2, Part 2 wave 3). The
 * settings button flips the note's contents to this face; pressing it
 * again, or Escape, flips back (spec §4, "Settings").
 *
 * The first settings are the note's colour and its collapse thresholds
 * (wave 5). Both are read-only for now: storing either on the note is a new
 * record shape in the `.tree` (⚠ gate 2, and the colour with it), so every
 * note shows the defaults until Kaelen approves the names.
 *
 * The flip is render-only: a 0→1 `Amount` turns the face in about its
 * vertical axis over the card's contents, through the shared frame loop.
 * With the `noteFlip` effect off it swaps at once.
 */

import { memo, useEffect, useRef, useState } from 'react'
import { Amount, effectStrength, frameScheduler, readMotionSettings, smoothstep } from './motion'
import { LOOK } from './values'

export interface NoteSettingsProps {
  readonly open: boolean
  readonly onClose: () => void
}

function NoteSettingsImpl({ open, onClose }: NoteSettingsProps): React.ReactElement | null {
  const amount = useRef<Amount | null>(null)
  if (!amount.current) amount.current = new Amount(LOOK.detail.noteFlipMs, smoothstep)
  const faceRef = useRef<HTMLDivElement>(null)
  // Mounted while open or still turning away.
  const [shown, setShown] = useState(open)
  if (open && !shown) setShown(true)

  useEffect(() => {
    const a = amount.current as Amount
    a.set(open ? 1 : 0)
    const strength = effectStrength(readMotionSettings(), 'noteFlip')
    const paint = (): void => {
      const el = faceRef.current
      if (!el) return
      const v = a.value
      el.style.transform = `perspective(900px) rotateY(${((1 - v) * 90).toFixed(2)}deg)`
      el.style.opacity = v > 0.02 ? '1' : '0'
    }
    if (strength <= 0) a.step(0, 0)
    paint()
    if (a.settled) {
      if (!open) setShown(false)
      return
    }
    const unsubscribe = frameScheduler().subscribe((_now, dt) => {
      a.step(dt, strength)
      paint()
      if (a.settled) {
        unsubscribe()
        if (!open) setShown(false)
      }
    })
    return unsubscribe
  }, [open, shown])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!shown) return null
  return (
    <div
      ref={faceRef}
      className="tapestry-note-settings"
      role="group"
      aria-label="Note settings"
      style={{ transform: 'perspective(900px) rotateY(90deg)', opacity: 0 }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="tapestry-note-settings-title">Settings</div>
      <div className="tapestry-note-settings-row" title="Every note uses the paper colour for now">
        <span>Colour</span>
        <span className="tapestry-note-settings-swatch" aria-hidden="true" />
        <span className="tapestry-note-settings-value">Paper</span>
      </div>
      <div className="tapestry-note-settings-group">Collapse</div>
      <label className="tapestry-note-settings-row" title="Every note uses the default for now">
        <span>Circle below</span>
        <input type="number" value={LOOK.collapse.circleBelowPx} readOnly disabled />
        <span className="tapestry-note-settings-unit">px</span>
      </label>
      <label className="tapestry-note-settings-row" title="Every note uses the default for now">
        <span>Dot below</span>
        <input type="number" value={LOOK.collapse.dotBelowPx} readOnly disabled />
        <span className="tapestry-note-settings-unit">px</span>
      </label>
    </div>
  )
}

export const NoteSettings = memo(NoteSettingsImpl)
