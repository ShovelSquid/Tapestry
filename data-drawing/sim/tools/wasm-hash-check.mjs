#!/usr/bin/env node
// wasm-hash-check.mjs — replay a golden fixture through the Wasm module in
// Node and compare every checkpoint hash with the committed .sha256 file.
//
//   node tools/wasm-hash-check.mjs <ddsim.mjs> <fixture.actions> <fixture.sha256>
//
// Prints "OK <name> <n checkpoints>" and exits 0, or "MISMATCH ..." for the
// first differing tick and exits 1. Same replay rule as golden_support.hpp.
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [glueArg, actionsArg, shaArg] = process.argv.slice(2)
if (!glueArg || !actionsArg || !shaArg) {
  console.error('usage: wasm-hash-check.mjs <ddsim.mjs> <fixture.actions> <fixture.sha256>')
  process.exit(2)
}

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

export function hexOf(bytes) {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

// Replays through the flat C ABI. Action bytes go through _malloc into the
// heap (HEAPU8 re-read from the module at every use, never cached) and are
// freed after each apply. Returns [{ tick, hex }] in checkpoint order.
export function replay(mod, fixture) {
  const sim = mod._dd_create(fixture.seed)
  if (!sim) throw new Error('dd_create returned null')
  const out = []
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

const { default: createDdsim } = await import(pathToFileURL(resolve(glueArg)).href)
const mod = await createDdsim()
const fixture = parseActions(readFileSync(actionsArg, 'utf8'))
const golden = parseSha256(readFileSync(shaArg, 'utf8'))
const got = replay(mod, fixture)
const name = basename(actionsArg).replace(/\.actions$/, '')

if (got.length !== golden.length) {
  console.log(`MISMATCH ${name}: ${got.length} checkpoints replayed, ${golden.length} in ${shaArg}`)
  process.exit(1)
}
for (let i = 0; i < golden.length; i++) {
  if (got[i].tick !== golden[i].tick || got[i].hex !== golden[i].hex) {
    console.log(`MISMATCH ${name} tick ${golden[i].tick}: wasm ${got[i].hex} golden ${golden[i].hex}`)
    process.exit(1)
  }
}
console.log(`OK ${name} ${got.length}`)
