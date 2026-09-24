/**
 * Replay-from-zero equality (SIM-03; phase success criterion 5, live half),
 * in Node with the real Wasm module and no Worker: the shared SimDriver —
 * the very code the Worker and the main-thread transport run — is driven
 * live-style tick by tick with a scripted stroke, then its own log is
 * replayed from zero into a second instance. Hashes must agree at the live
 * tick and at every hash-ring boundary (multiples of 60); one mutated
 * recorded byte must be reported as a DIFF located within 60 ticks of the
 * mutated action; and the transport-switch restore must reproduce the live
 * state exactly.
 */
import { describe, expect, it } from 'vitest'

import createMathspace from '../wasm/mathspace.mjs'
import { PRESETS } from '../src/brushes'
import { ActionKind, hexOf, type SampleFields } from '../src/ddsim-abi'
import type { MathspaceModule } from '../src/ms-abi'
import { DEFAULT_PLANE, frameToQ16 } from '../src/plane'
import { formatReplayLine, verdictOf } from '../src/replay'
import { HASH_RING_EVERY, SimDriver, hashesEqual, type LogEntry } from '../src/sim-driver'
import { replay } from './fixture-replay'

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

const SEED = 42n
const STROKE_START = 10
const SAMPLES = 40
const LIVE_TICK = 300

/**
 * A live session driven exactly as a transport drives it: define ink at
 * tick 0, step to 10, open stroke 1, one sample per tick for 40 ticks
 * (10..49), end at 50, then idle to tick 300.
 */
function liveSession(mod: MathspaceModule): SimDriver {
  const live = new SimDriver(mod, SEED)
  expect(live.defineBrush(PRESETS[0]!).ok).toBe(true)
  live.stepTicks(STROKE_START)
  expect(live.beginStroke(1, 1, frameToQ16(DEFAULT_PLANE), 0).ok).toBe(true)
  for (let t = 0; t < SAMPLES; t++) {
    expect(live.pushSamples(1, [syntheticSample(t)]).ok).toBe(true)
    live.stepTicks(1)
  }
  expect(live.endStroke(1).ok).toBe(true)
  live.stepTicks(LIVE_TICK - live.tick())
  expect(live.tick()).toBe(LIVE_TICK)
  return live
}

describe('replay from zero (SimDriver.replayFromZero)', () => {
  it('MATCH: the session log replayed from zero reproduces the live hash and node count at tick 300 and at every multiple of 60', async () => {
    const mod = await createMathspace()
    const live = liveSession(mod)
    try {
      const liveHash = live.hash()
      const report = live.replayFromZero()
      expect(report.liveTick).toBe(LIVE_TICK)
      expect(report.nodeCount).toBeGreaterThan(0)
      expect(report.replayNodeCount).toBe(report.nodeCount)
      expect(hexOf(report.replayHash)).toBe(hexOf(report.liveHash))
      expect(report.firstDiffTick).toBeNull()
      expect(verdictOf(report).match).toBe(true)
      expect(formatReplayLine(report)).toBe(`replay: MATCH (tick ${LIVE_TICK}, nodes ${report.nodeCount})`)

      // The ring holds one hash per multiple of 60 up to the live tick, and
      // each equals an independent fixture-rule replay of the same log at
      // that checkpoint (no action lands on those ticks, so "before the
      // tick's actions" and "after" coincide).
      const ring = live.hashRing()
      const boundaries = [60, 120, 180, 240, 300]
      expect(HASH_RING_EVERY).toBe(60)
      expect(ring.map((r) => r.tick)).toEqual(boundaries)
      const independent = replay(mod, { seed: SEED, actions: live.log(), checkpoints: boundaries })
      expect(independent.map((g) => g.hex)).toEqual(ring.map((r) => hexOf(r.hash)))

      // The comparison touched nothing: the live hash is unchanged.
      expect(hexOf(live.hash())).toBe(hexOf(liveHash))
      expect(live.tick()).toBe(LIVE_TICK)
    } finally {
      live.destroy()
    }
  })

  it('DIFF: one mutated recorded byte is reported with a firstDiffTick at most 60 ticks after the mutated action', async () => {
    const mod = await createMathspace()
    const live = liveSession(mod)
    try {
      const liveHash = live.hash()
      const entries: LogEntry[] = live.log()
      const idx = entries.findIndex((e) => e.bytes[0] === ActionKind.StrokeSamples)
      expect(idx).toBeGreaterThan(0)
      const mutatedEntry = entries[idx]!
      // Payload: u64 stroke_id | u32 count | sample { u32 tick, u16 index, u16 pressure, i32 u, ... }:
      // byte 28 is the low byte of the first sample's u. Flip one bit — still in range, so the
      // action is accepted and the body target moves by one Q16.16 unit.
      const mutated = entries.map((e, i) => (i === idx ? { tick: e.tick, bytes: e.bytes.slice() } : e))
      mutated[idx]!.bytes[28] = mutated[idx]!.bytes[28]! ^ 0x01

      const report = live.replayFromZero(mutated)
      expect(report.liveTick).toBe(LIVE_TICK)
      expect(hexOf(report.replayHash)).not.toBe(hexOf(report.liveHash))
      expect(report.firstDiffTick).not.toBeNull()
      expect(report.firstDiffTick!).toBeGreaterThan(mutatedEntry.tick)
      expect(report.firstDiffTick!).toBeLessThanOrEqual(mutatedEntry.tick + 60)
      expect(verdictOf(report).match).toBe(false)
      expect(formatReplayLine(report)).toBe(`replay: DIFF at tick ${report.firstDiffTick}`)
      console.log(`replay DIFF: mutated action at tick ${mutatedEntry.tick}, firstDiffTick ${report.firstDiffTick}`)

      // The live state was only read.
      expect(hashesEqual(live.hash(), liveHash)).toBe(true)
    } finally {
      live.destroy()
    }
  })

  it('DIFF: an action the replay rejects is reported at its own tick', async () => {
    const mod = await createMathspace()
    const live = liveSession(mod)
    try {
      const entries = live.log()
      const idx = entries.findIndex((e) => e.bytes[0] === ActionKind.StrokeSamples)
      const mutated = entries.map((e, i) => (i === idx ? { tick: e.tick, bytes: e.bytes.slice() } : e))
      // pad byte of the first sample (payload offset 21..23 of the sample -> byte 8 + 12 + 21 = 41) must be zero
      mutated[idx]!.bytes[41] = 1
      const report = live.replayFromZero(mutated)
      expect(report.firstDiffTick).toBe(entries[idx]!.tick)
      expect(verdictOf(report).match).toBe(false)
    } finally {
      live.destroy()
    }
  })

  it('restore (the transport switch): a fresh driver restored from the log and tick hashes identically, keeps the log, and its own replay matches', async () => {
    const mod = await createMathspace()
    const live = liveSession(mod)
    const replica = new SimDriver(mod, SEED)
    try {
      const rejected = replica.restore({ entries: live.log(), tick: LIVE_TICK })
      expect(rejected).toBe(0)
      expect(replica.tick()).toBe(LIVE_TICK)
      expect(hexOf(replica.hash())).toBe(hexOf(live.hash()))
      expect(replica.nodeCount()).toBe(live.nodeCount())
      expect(replica.log().map((e) => [e.tick, hexOf(e.bytes)])).toEqual(live.log().map((e) => [e.tick, hexOf(e.bytes)]))
      expect(replica.hashRing().map((r) => [r.tick, hexOf(r.hash)])).toEqual(live.hashRing().map((r) => [r.tick, hexOf(r.hash)]))
      const report = replica.replayFromZero()
      expect(report.firstDiffTick).toBeNull()
      // The replica continues the session: a second brush gets id 2 (brush count rebuilt from the log).
      const o = replica.defineBrush(PRESETS[1]!)
      expect(o.ok && o.result).toBe(2)
    } finally {
      replica.destroy()
      live.destroy()
    }
  })

  it('restore mid-stroke rebuilds the stamping state so the next samples are numbered as the sim expects', async () => {
    const mod = await createMathspace()
    const live = new SimDriver(mod, SEED)
    const replica = new SimDriver(mod, SEED)
    try {
      expect(live.defineBrush(PRESETS[0]!).ok).toBe(true)
      live.stepTicks(5)
      expect(live.beginStroke(1, 1, frameToQ16(DEFAULT_PLANE), 0).ok).toBe(true)
      expect(live.pushSamples(1, [syntheticSample(0), syntheticSample(1)]).ok).toBe(true)
      // Two samples already on tick 5: the next index on tick 5 must be 2.
      expect(replica.restore({ entries: live.log(), tick: live.tick() })).toBe(0)
      expect(replica.pushSamples(1, [syntheticSample(2)]).ok).toBe(true)
      expect(live.pushSamples(1, [syntheticSample(2)]).ok).toBe(true)
      expect(hexOf(replica.hash())).toBe(hexOf(live.hash()))
      replica.stepTicks(1)
      live.stepTicks(1)
      expect(replica.endStroke(1).ok).toBe(true)
      expect(live.endStroke(1).ok).toBe(true)
      expect(hexOf(replica.hash())).toBe(hexOf(live.hash()))
    } finally {
      replica.destroy()
      live.destroy()
    }
  })

  it('advance(now) steps whole ticks only and clamps a stall to MAX_FRAME_MS', async () => {
    const mod = await createMathspace()
    const d = new SimDriver(mod, SEED)
    try {
      d.resetClock(1000)
      expect(d.advance(1000 + 1000 / 60 - 0.01)).toBe(0)
      expect(d.tick()).toBe(0)
      expect(d.advance(1000 + 1000 / 60 + 0.5)).toBe(1)
      expect(d.tick()).toBe(1)
      // A 10 s stall owes at most 250 ms = 15 ticks.
      expect(d.advance(1000 + 10000)).toBe(15)
      expect(d.tick()).toBe(16)
      d.pause(true)
      expect(d.advance(1000 + 20000)).toBe(0)
      expect(d.tick()).toBe(16)
    } finally {
      d.destroy()
    }
  })
})
