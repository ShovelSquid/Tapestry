/**
 * fixture-replay.ts — the golden fixture text formats and the replay rule,
 * shared by the Vitest golden test. Same rule as sim/tests/golden_support.hpp
 * and sim/tools/wasm-hash-check.mjs:
 *
 *   for t = 0..max: apply every action stamped t (in file order); if t is a
 *   checkpoint, record the hash (after those applies, before the step); step.
 */
import type { DdsimModule } from '../src/ddsim-abi'
import { hexOf } from '../src/ddsim-abi'

export interface FixtureAction {
  tick: number
  bytes: Uint8Array
}

export interface Fixture {
  seed: bigint
  actions: FixtureAction[]
  checkpoints: number[]
}

export interface GoldenLine {
  tick: number
  hex: string
}

export function parseActions(text: string): Fixture {
  const fixture: Fixture = { seed: 0n, actions: [], checkpoints: [] }
  let sawSeed = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '' || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const [word, a, b] = parts
    if (word === 'seed' && parts.length === 2 && a !== undefined && /^\d+$/.test(a)) {
      fixture.seed = BigInt(a)
      sawSeed = true
    } else if (word === 'action' && parts.length === 3 && a !== undefined && b !== undefined && /^\d+$/.test(a) && /^([0-9a-fA-F]{2})*$/.test(b)) {
      const bytes = new Uint8Array(b.length / 2)
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(b.slice(i * 2, i * 2 + 2), 16)
      fixture.actions.push({ tick: Number(a), bytes })
    } else if (word === 'checkpoint' && parts.length === 2 && a !== undefined && /^\d+$/.test(a)) {
      const tick = Number(a)
      const last = fixture.checkpoints[fixture.checkpoints.length - 1]
      if (last !== undefined && tick <= last) throw new Error(`checkpoints not ascending at: ${line}`)
      fixture.checkpoints.push(tick)
    } else {
      throw new Error(`bad fixture line: ${line}`)
    }
  }
  if (!sawSeed) throw new Error('fixture has no seed')
  return fixture
}

export function parseSha256(text: string): GoldenLine[] {
  const out: GoldenLine[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') continue
    const m = /^(\d+) ([0-9a-f]{64})$/.exec(line)
    if (m === null || m[1] === undefined || m[2] === undefined) throw new Error(`bad sha256 line: ${line}`)
    out.push({ tick: Number(m[1]), hex: m[2] })
  }
  return out
}

/** Replays through the flat C ABI; returns the checkpoint hashes in order. */
export function replay(mod: DdsimModule, fixture: Fixture): GoldenLine[] {
  const sim = mod._dd_create(fixture.seed)
  if (sim === 0) throw new Error('dd_create returned null')
  const out: GoldenLine[] = []
  try {
    let max = 0
    for (const a of fixture.actions) max = Math.max(max, a.tick)
    for (const c of fixture.checkpoints) max = Math.max(max, c)
    let next = 0
    for (let t = 0; t <= max; t++) {
      for (const a of fixture.actions) {
        if (a.tick !== t) continue
        const ptr = mod._malloc(a.bytes.length)
        try {
          mod.HEAPU8.set(a.bytes, ptr)
          const rc = mod._dd_apply(sim, ptr, a.bytes.length)
          if (rc !== 0) throw new Error(`dd_apply rejected action at tick ${t} with code ${rc}`)
        } finally {
          mod._free(ptr)
        }
      }
      if (next < fixture.checkpoints.length && fixture.checkpoints[next] === t) {
        const hp = mod._malloc(32)
        try {
          mod._dd_hash(sim, hp)
          out.push({ tick: t, hex: hexOf(mod.HEAPU8.slice(hp, hp + 32)) })
        } finally {
          mod._free(hp)
        }
        next++
      }
      mod._dd_step(sim)
    }
  } finally {
    mod._dd_destroy(sim)
  }
  return out
}
