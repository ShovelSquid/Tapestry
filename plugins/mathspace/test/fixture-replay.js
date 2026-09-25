/**
 * fixture-replay.js — parse tests/golden/ms fixtures and replay them through
 * an Engine. Same grammar and replay rule as tools/wasm-hash-check.mjs and
 * tests/mathspace/golden_support.hpp; that script cannot be imported because
 * it runs its main on load.
 */
import { Engine } from './engine-cjs.js'

export function parseActions(text) {
  const fixture = { seed: 0n, actions: [], checkpoints: [] }
  let sawSeed = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '' || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    if (parts[0] === 'seed' && parts.length === 2 && /^\d+$/.test(parts[1])) {
      fixture.seed = BigInt(parts[1])
      sawSeed = true
    } else if (parts[0] === 'action' && parts.length === 3 && /^\d+$/.test(parts[1]) && /^([0-9a-fA-F]{2})*$/.test(parts[2])) {
      const bytes = new Uint8Array(parts[2].length / 2)
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(parts[2].slice(i * 2, i * 2 + 2), 16)
      fixture.actions.push({ tick: Number(parts[1]), bytes })
    } else if (parts[0] === 'checkpoint' && parts.length === 2 && /^\d+$/.test(parts[1])) {
      const tick = Number(parts[1])
      const last = fixture.checkpoints[fixture.checkpoints.length - 1]
      if (last !== undefined && tick <= last) throw new Error(`checkpoints not ascending at ${line}`)
      fixture.checkpoints.push(tick)
    } else {
      throw new Error(`bad fixture line: ${line}`)
    }
  }
  if (!sawSeed) throw new Error('fixture has no seed')
  return fixture
}

export function parseSha256(text) {
  const out = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') continue
    const m = /^(\d+) ([0-9a-f]{64})$/.exec(line)
    if (!m) throw new Error(`bad sha256 line: ${line}`)
    out.push({ tick: Number(m[1]), hex: m[2] })
  }
  return out
}

/** Replay a fixture; returns [{ tick, hex }] in checkpoint order. */
export function replay(mod, fixture) {
  const engine = new Engine(mod, fixture.seed)
  const out = []
  try {
    let max = 0
    for (const a of fixture.actions) max = Math.max(max, a.tick)
    for (const c of fixture.checkpoints) max = Math.max(max, c)
    let next = 0
    for (let t = 0; t <= max; t++) {
      for (const a of fixture.actions) {
        if (a.tick !== t) continue
        const rc = engine.apply(a.bytes)
        if (rc !== 0) throw new Error(`ms_apply rejected action at tick ${t} with code ${rc}`)
      }
      if (next < fixture.checkpoints.length && fixture.checkpoints[next] === t) {
        out.push({ tick: t, hex: engine.hash() })
        next++
      }
      engine.step()
    }
  } finally {
    engine.destroy()
  }
  return out
}
