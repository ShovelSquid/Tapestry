/**
 * The plugin's Wasm module must reproduce the native goldens byte for byte,
 * through the same Engine wrapper index.js will use. Runs against the real
 * wasm/mathspace.mjs from `npm run engine:wasm`; a mock would prove nothing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { Engine, GLUE_PATH, loadModule } from './engine-cjs.js'
import { encodeBindField, encodeCreateNote, encodeCreateSpace, encodeSetField, parseSnapshot } from './image-cjs.js'
import { parseActions, parseSha256, replay } from './fixture-replay.js'

const GOLDEN_DIR = fileURLToPath(new URL('../../../tests/golden/ms/', import.meta.url))

const fixtureNames = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith('.actions'))
  .map((f) => f.replace(/\.actions$/, ''))
  .sort()

describe('engine wasm golden replay', () => {
  it('the module was built (npm run engine:wasm)', () => {
    expect(existsSync(GLUE_PATH)).toBe(true)
  })

  it('finds the committed fixtures', () => {
    expect(fixtureNames).toContain('empty')
    expect(fixtureNames).toContain('velocity')
  })

  it('reports ABI version 3', async () => {
    const mod = await loadModule()
    expect(mod._ms_version()).toBe(3)
  })

  it('errors() is empty on a fresh engine and after a clean step', async () => {
    const mod = await loadModule()
    const engine = new Engine(mod, 1n)
    expect(engine.errors()).toEqual([])
    engine.step()
    expect(engine.errors()).toEqual([])
    engine.destroy()
  })

  for (const name of fixtureNames) {
    it(`${name}: the Wasm module reproduces every committed checkpoint hash`, async () => {
      const mod = await loadModule()
      const fixture = parseActions(readFileSync(join(GOLDEN_DIR, `${name}.actions`), 'utf8'))
      const golden = parseSha256(readFileSync(join(GOLDEN_DIR, `${name}.sha256`), 'utf8'))
      expect(golden.length).toBeGreaterThan(0)
      expect(replay(mod, fixture)).toEqual(golden)
    })
  }

  it('a rejected action leaves the hash unchanged', async () => {
    const mod = await loadModule()
    const engine = new Engine(mod, 1n)
    try {
      const before = engine.hash()
      // Opcode 0xff is not in the grammar.
      expect(engine.apply(new Uint8Array([0xff, 0, 0, 0]))).not.toBe(0)
      expect(engine.hash()).toBe(before)
    } finally {
      engine.destroy()
    }
  })

  it('serialize/restore round-trips the velocity world at tick 10', async () => {
    const mod = await loadModule()
    const fixture = parseActions(readFileSync(join(GOLDEN_DIR, 'velocity.actions'), 'utf8'))
    const a = new Engine(mod, fixture.seed)
    const b = new Engine(mod, 7n)
    try {
      for (const act of fixture.actions) expect(a.apply(act.bytes)).toBe(0)
      for (let i = 0; i < 10; i++) a.step()
      expect(a.tick()).toBe(10n)
      const bytes = a.serialize()
      expect(bytes.length).toBeGreaterThan(0)
      expect(b.restore(bytes)).toBe(0)
      expect(b.tick()).toBe(10n)
      expect(b.hash()).toBe(a.hash())
      expect(b.notes()).toEqual(a.notes())
      expect(a.notes().length).toBeGreaterThan(0)
    } finally {
      a.destroy()
      b.destroy()
    }
  })

  it('compile returns bytecode that binds and evaluates', async () => {
    const mod = await loadModule()
    const e = new Engine(mod, 1n)
    try {
      const one = 1n << 32n
      expect(e.apply(encodeCreateSpace(1n, 2))).toBe(0)
      expect(e.apply(encodeCreateNote(2n, 1n, 1))).toBe(0)
      expect(e.apply(encodeSetField(2n, { name: 'pos', dim: 2, lanes: [one, 2n * one] }))).toBe(0)
      expect(e.apply(encodeSetField(2n, { name: 'k', dim: 1, lanes: [3n * one] }))).toBe(0)
      const r = e.compile(2n, 'self.pos * self.k + [1, 2]')
      expect(r.error).toBeUndefined()
      expect(r.code.length).toBeGreaterThan(6)
      expect(r.code[0]).toBe(1) // BYTECODE_VERSION
      expect(r.code[1]).toBe(2) // result dim
      const before = e.hash()
      expect(e.apply(encodeBindField(2n, 'q', r.code))).toBe(0)
      e.step()
      expect(e.hash()).not.toBe(before)
      const notes = parseSnapshot(e.notes())
      expect(notes.get(2n).get('q')).toEqual([4n * one, 8n * one])
    } finally {
      e.destroy()
    }
  })

  it('compile reports stage, name and offset on failure, and touches nothing', async () => {
    const mod = await loadModule()
    const e = new Engine(mod, 1n)
    try {
      expect(e.apply(encodeCreateSpace(1n, 2))).toBe(0)
      expect(e.apply(encodeCreateNote(2n, 1n, 1))).toBe(0)
      expect(e.apply(encodeSetField(2n, { name: 'pos', dim: 2, lanes: [0n, 0n] }))).toBe(0)
      const before = e.hash()
      expect(e.compile(9n, '1')).toEqual({ error: 'world:NoSuchNote', where: 0 })
      expect(e.compile(2n, '1 + 0.1')).toEqual({ error: 'parse:InexactNumber', where: 4 })
      expect(e.compile(2n, 'self.pos + 1')).toEqual({ error: 'compile:DimMismatch', where: expect.any(Number) })
      expect(e.compile(2n, 'self.nope')).toEqual({ error: 'compile:UnknownRef', where: expect.any(Number) })
      expect(e.compile(2n, 'sin(π)')).toEqual({ error: 'parse:UnexpectedChar', where: 4 })
      expect(e.hash()).toBe(before)
    } finally {
      e.destroy()
    }
  })
})
