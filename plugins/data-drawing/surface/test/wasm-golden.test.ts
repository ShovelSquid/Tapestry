/**
 * The Wasm module must reproduce the native goldens byte for byte, and the
 * TypeScript action encoder must produce the same bytes as the C++ one.
 * These run against the real ddsim.mjs/ddsim.wasm (surface/wasm/, from
 * `npm run sim:wasm`); a mocked module would prove nothing here.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import createDdsim from '../wasm/ddsim.mjs'
import { INK_BRUSH, encodeDefineBrush, hexOf, type DdsimModule } from '../src/ddsim-abi'
import { parseActions, parseSha256, replay } from './fixture-replay'

const GOLDEN_DIR = fileURLToPath(new URL('../../../../data-drawing/sim/tests/golden/', import.meta.url))

const fixtureNames = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith('.actions'))
  .map((f) => f.replace(/\.actions$/, ''))
  .sort()

let modulePromise: Promise<DdsimModule> | null = null
function loadModule(): Promise<DdsimModule> {
  const p = modulePromise ?? createDdsim()
  modulePromise = p
  return p
}

describe('wasm golden replay', () => {
  it('finds the committed fixtures', () => {
    expect(fixtureNames).toContain('noop')
    expect(fixtureNames).toContain('one-brush')
  })

  for (const name of fixtureNames) {
    it(`${name}: the Wasm module reproduces every committed checkpoint hash`, async () => {
      const mod = await loadModule()
      const fixture = parseActions(readFileSync(join(GOLDEN_DIR, `${name}.actions`), 'utf8'))
      const golden = parseSha256(readFileSync(join(GOLDEN_DIR, `${name}.sha256`), 'utf8'))
      expect(golden.length).toBeGreaterThan(0)
      const got = replay(mod, fixture)
      expect(got).toEqual(golden)
    })
  }

  it('encodeDefineBrush(INK_BRUSH, 1) equals the action 0 bytes of one-brush.actions', () => {
    const fixture = parseActions(readFileSync(join(GOLDEN_DIR, 'one-brush.actions'), 'utf8'))
    const action0 = fixture.actions.find((a) => a.tick === 0)
    expect(action0).toBeDefined()
    expect(hexOf(encodeDefineBrush(INK_BRUSH, 1))).toBe(hexOf(action0!.bytes))
  })

  it('a rejected action leaves the Wasm hash unchanged', async () => {
    const mod = await loadModule()
    const sim = mod._dd_create(42n)
    try {
      const hashOf = (): string => {
        const hp = mod._malloc(32)
        try {
          mod._dd_hash(sim, hp)
          return hexOf(mod.HEAPU8.slice(hp, hp + 32))
        } finally {
          mod._free(hp)
        }
      }
      const before = hashOf()
      const wrongId = encodeDefineBrush(INK_BRUSH, 2)
      const ptr = mod._malloc(wrongId.length)
      try {
        mod.HEAPU8.set(wrongId, ptr)
        expect(mod._dd_apply(sim, ptr, wrongId.length)).toBe(5) // DD_ERR_BRUSH_ID
      } finally {
        mod._free(ptr)
      }
      expect(hashOf()).toBe(before)
      expect(Number(mod._dd_tick(sim))).toBe(0)
    } finally {
      mod._dd_destroy(sim)
    }
  })
})
