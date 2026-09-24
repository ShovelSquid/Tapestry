/**
 * The TS stroke encoder must be byte-identical to the one C++ encoder
 * (sim/tests/action_writer.hpp): the PRESETS table encodes to the exact
 * `presets.actions` bytes, a one-stroke log built in TS from the synthetic
 * curve equals `one-stroke.actions` line by line, and replaying that
 * TS-built log through the real Wasm module reproduces `one-stroke.sha256`.
 * The Worker's stamping is a pure function, tested here without a Worker.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import createDdsim from '../wasm/ddsim.mjs'
import { PRESETS } from '../src/brushes'
import {
  MAX_SAMPLES_PER_TICK,
  branchOf,
  encodeDefineBrush,
  encodeStrokeBegin,
  encodeStrokeEnd,
  encodeStrokeSamples,
  hexOf,
  ordinalOf,
  stampSamples,
  strokeIdOf,
  type SampleFields,
  type StampState,
} from '../src/ddsim-abi'
import { DEFAULT_PLANE, frameToQ16 } from '../src/plane'
import { parseActions, parseSha256, replay, type Fixture, type FixtureAction } from './fixture-replay'

const GOLDEN_DIR = fileURLToPath(new URL('../../../../data-drawing/sim/tests/golden/', import.meta.url))

function fixture(name: string): Fixture {
  return parseActions(readFileSync(join(GOLDEN_DIR, `${name}.actions`), 'utf8'))
}

/**
 * The synthetic stroke curve every stroke fixture uses (action_writer.hpp
 * synthetic_sample): u = t * 16384, v = ((t * 7) % 40 - 20) * 8192,
 * pressure = min(65535, t * 546), no tilt, no twist, flags 0.
 */
function syntheticSample(t: number): SampleFields {
  return {
    u: t * 16384,
    v: (((t * 7) % 40) - 20) * 8192,
    pressure: Math.min(65535, t * 546),
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    flags: 0,
  }
}

/** one-stroke: ink at 0; ordinal 1 begins at 10; 120 samples one per tick at 10..129 (index 0); end at 130. */
function buildOneStroke(): FixtureAction[] {
  const out: FixtureAction[] = []
  out.push({ tick: 0, bytes: encodeDefineBrush(PRESETS[0]!, 1) })
  const id = strokeIdOf(0, 1)
  out.push({ tick: 10, bytes: encodeStrokeBegin(id, 1, 10, 0, frameToQ16(DEFAULT_PLANE)) })
  for (let t = 0; t < 120; t++) {
    const tick = 10 + t
    out.push({ tick, bytes: encodeStrokeSamples(id, [{ ...syntheticSample(t), tick, index: 0 }]) })
  }
  out.push({ tick: 130, bytes: encodeStrokeEnd(id, 130) })
  return out
}

describe('TS encoder vs the C++ goldens', () => {
  it('(1) encodeDefineBrush(PRESETS[i], i + 1) equals presets.actions at ticks 0..3', () => {
    const f = fixture('presets')
    expect(f.actions).toHaveLength(4)
    expect(PRESETS.map((p) => p.description)).toEqual(['ink', 'rust', 'clay', 'lead'])
    for (let i = 0; i < 4; i++) {
      const golden = f.actions.find((a) => a.tick === i)
      expect(golden).toBeDefined()
      expect(hexOf(encodeDefineBrush(PRESETS[i]!, i + 1))).toBe(hexOf(golden!.bytes))
    }
  })

  it('(1b) the preset masses are 1, 4, 16, 64 in Q32.32 raw', () => {
    expect(PRESETS.map((p) => p.mass)).toEqual([4294967296n, 17179869184n, 68719476736n, 274877906944n])
  })

  it('(2) a TS-built one-stroke log equals one-stroke.actions line by line', () => {
    const golden = fixture('one-stroke')
    const built = buildOneStroke()
    expect(built).toHaveLength(golden.actions.length)
    built.forEach((a, i) => {
      const g = golden.actions[i]!
      expect(a.tick, `line ${i} tick`).toBe(g.tick)
      expect(hexOf(a.bytes), `line ${i} bytes`).toBe(hexOf(g.bytes))
    })
    // The shapes the wire layouts fix.
    expect(built[1]!.bytes).toHaveLength(8 + 56)
    expect(built[2]!.bytes).toHaveLength(8 + 12 + 24)
    expect(built[built.length - 1]!.bytes).toHaveLength(8 + 12)
  })

  it('(3) replaying the TS-built log through the Wasm module reproduces one-stroke.sha256 at 10, 70, 130, 600', async () => {
    const mod = await createDdsim()
    const golden = parseSha256(readFileSync(join(GOLDEN_DIR, 'one-stroke.sha256'), 'utf8'))
    expect(golden.map((g) => g.tick)).toEqual([10, 70, 130, 600])
    const got = replay(mod, { seed: 42n, actions: buildOneStroke(), checkpoints: [10, 70, 130, 600] })
    expect(got).toEqual(golden)
  })

  it('(4) stampSamples: indices 0,1,2 within one tick, then 0 after the tick moved on', () => {
    const one = (t: number): SampleFields[] => [syntheticSample(t)]
    let state: StampState = { tick: -1, nextIndex: 0 }
    const a = stampSamples(state, 50, one(0))
    state = a.state
    const b = stampSamples(state, 50, one(1))
    state = b.state
    const c = stampSamples(state, 50, one(2))
    state = c.state
    expect(a.samples.map((s) => s.index)).toEqual([0])
    expect(b.samples.map((s) => s.index)).toEqual([1])
    expect(c.samples.map((s) => s.index)).toEqual([2])
    expect(a.samples[0]!.tick).toBe(50)
    expect(state).toEqual({ tick: 50, nextIndex: 3 })
    const d = stampSamples(state, 51, one(3))
    expect(d.samples.map((s) => s.index)).toEqual([0])
    expect(d.samples[0]!.tick).toBe(51)
    expect(d.state).toEqual({ tick: 51, nextIndex: 1 })
  })

  it('(4b) stampSamples numbers a multi-sample batch consecutively and is pure', () => {
    const state: StampState = { tick: 7, nextIndex: 2 }
    const batch = [syntheticSample(0), syntheticSample(1), syntheticSample(2)]
    const r = stampSamples(state, 7, batch)
    expect(r.samples.map((s) => s.index)).toEqual([2, 3, 4])
    expect(r.samples.map((s) => s.tick)).toEqual([7, 7, 7])
    expect(r.samples[1]!.u).toBe(batch[1]!.u)
    expect(state).toEqual({ tick: 7, nextIndex: 2 })
    expect(r.state).toEqual({ tick: 7, nextIndex: 5 })
    expect(MAX_SAMPLES_PER_TICK).toBe(64)
  })

  it('(4c) a stamped stroke applied through the Wasm module is accepted (index rule matches the sim)', async () => {
    const mod = await createDdsim()
    const sim = mod._dd_create(42n)
    const applyAt = (bytes: Uint8Array): number => {
      const ptr = mod._malloc(bytes.length)
      try {
        mod.HEAPU8.set(bytes, ptr)
        return mod._dd_apply(sim, ptr, bytes.length)
      } finally {
        mod._free(ptr)
      }
    }
    try {
      expect(applyAt(encodeDefineBrush(PRESETS[3]!, 1))).toBe(0)
      mod._dd_step(sim)
      const id = strokeIdOf(0, 1)
      expect(applyAt(encodeStrokeBegin(id, 1, 1, 1, frameToQ16(DEFAULT_PLANE)))).toBe(0)
      let state: StampState = { tick: 1, nextIndex: 0 }
      // Three batches on tick 1, then one on tick 2, exactly as the worker would stamp them.
      for (const batch of [[syntheticSample(0), syntheticSample(1)], [syntheticSample(2)], [syntheticSample(3)]]) {
        const r = stampSamples(state, 1, batch.map((s) => ({ ...s, flags: 4 })))
        expect(applyAt(encodeStrokeSamples(id, r.samples))).toBe(0)
        state = r.state
      }
      mod._dd_step(sim)
      const r = stampSamples(state, 2, [{ ...syntheticSample(4), flags: 4 }])
      expect(r.samples[0]!.index).toBe(0)
      expect(applyAt(encodeStrokeSamples(id, r.samples))).toBe(0)
      // End on the same tick as that tick's samples: accepted (01-05 flush).
      expect(applyAt(encodeStrokeEnd(id, 2))).toBe(0)
      expect(mod._dd_body_count(sim)).toBe(0)
      expect(mod._dd_node_count(sim)).toBeGreaterThan(0)
    } finally {
      mod._dd_destroy(sim)
    }
  })

  it('stroke ids pack (branch, ordinal) as bigint and unpack again', () => {
    expect(strokeIdOf(0, 1)).toBe(1n)
    expect(strokeIdOf(3, 0xffffffff)).toBe((3n << 32n) | 0xffffffffn)
    expect(ordinalOf(strokeIdOf(7, 123456))).toBe(123456)
    expect(branchOf(strokeIdOf(7, 123456))).toBe(7)
    expect(() => strokeIdOf(0, 0)).toThrow(RangeError)
    expect(() => strokeIdOf(256, 1)).toThrow(RangeError)
  })
})
