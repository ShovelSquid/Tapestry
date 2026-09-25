/**
 * Per-thread settings and the D-27 stored frame.
 */

import { describe, expect, it } from 'vitest'
import {
  defaultThreadFrame,
  defaultThreadSettings,
  parseThreadFrame,
  parseThreadSettings,
  threadInitialProperties,
  THREAD_DEFAULT_FORMAT,
  THREAD_DEFAULT_SLOWDOWN,
  THREAD_DEFAULT_TIMEOUT_SECONDS,
} from './settings'

describe('defaultThreadFrame', () => {
  it('places the origin at the card position, z 0, direction 0 0 -1, roll 0', () => {
    expect(defaultThreadFrame(120, 340)).toEqual({
      origin: { x: 120, y: 340, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
      roll: 0,
    })
  })
})

describe('parseThreadFrame', () => {
  it('reads default direction 0 0 -1 and roll 0 from an empty property map', () => {
    const frame = parseThreadFrame({})
    expect(frame.direction).toEqual({ x: 0, y: 0, z: -1 })
    expect(frame.roll).toBe(0)
  })

  it('falls back per key when only some are stored', () => {
    const frame = parseThreadFrame({
      'thread.origin.x': { type: 'real', value: 42 },
    })
    expect(frame.origin.x).toBe(42)
    expect(frame.origin.y).toBe(0)
    expect(frame.direction).toEqual({ x: 0, y: 0, z: -1 })
  })

  it('reads a fully stored frame back exactly', () => {
    const stored = threadInitialProperties(10, 20)
    const frame = parseThreadFrame(stored)
    expect(frame).toEqual(defaultThreadFrame(10, 20))
  })
})

describe('parseThreadSettings', () => {
  it('falls back to defaults from an empty property map', () => {
    expect(parseThreadSettings({})).toEqual(defaultThreadSettings())
  })

  it('reads a stored non-default timeout', () => {
    const settings = parseThreadSettings({ 'thread.timeout': { type: 'real', value: 60 } })
    expect(settings.timeout).toBe(60)
    expect(settings.slowdown).toBe(THREAD_DEFAULT_SLOWDOWN)
  })
})

describe('threadInitialProperties', () => {
  it('carries the D-10/D-13 defaults and an empty D-02 body/title', () => {
    const props = threadInitialProperties(120, 340)
    expect(props['position.x']).toEqual({ type: 'real', value: 120 })
    expect(props['position.y']).toEqual({ type: 'real', value: 340 })
    expect(props['thread.timeout']).toEqual({ type: 'real', value: THREAD_DEFAULT_TIMEOUT_SECONDS })
    expect(props['thread.slowdown']).toEqual({ type: 'text', value: THREAD_DEFAULT_SLOWDOWN })
    expect(props['thread.format']).toEqual({ type: 'int', value: THREAD_DEFAULT_FORMAT })
    expect(props.body).toEqual({ type: 'text', value: '' })
    expect(props.title).toEqual({ type: 'text', value: '' })
  })
})
