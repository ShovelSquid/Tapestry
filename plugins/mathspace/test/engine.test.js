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

  it('reports ABI version 1', async () => {
    const mod = await loadModule()
    expect(mod._ms_version()).toBe(1)
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
})
