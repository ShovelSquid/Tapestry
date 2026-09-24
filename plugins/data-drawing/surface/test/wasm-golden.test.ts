/**
 * The bridged engine must reproduce the committed golden hashes byte for
 * byte (surface/test/golden/*.sha256, ms_hash of the world the bridge
 * builds from each .actions fixture), and the TypeScript action encoder
 * must produce the same bytes as the recorded ones. These run against the
 * real mathspace.mjs/mathspace.wasm (surface/wasm/, from `npm run
 * sim:wasm`); a mocked module would prove nothing here. To re-record after
 * a deliberate hash change: `MS_WRITE_FIXTURES=1 npm test`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import createMathspace from '../wasm/mathspace.mjs'
import { INK_BRUSH, encodeDefineBrush, hexOf } from '../src/ddsim-abi'
import type { MathspaceModule } from '../src/ms-abi'
import { MsSim } from '../src/ms-sim'
import { formatSha256, parseActions, parseSha256, replay } from './fixture-replay'

export const GOLDEN_DIR = fileURLToPath(new URL('./golden/', import.meta.url))
const WRITE = process.env['MS_WRITE_FIXTURES'] === '1'

const fixtureNames = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith('.actions'))
  .map((f) => f.replace(/\.actions$/, ''))
  .sort()

let modulePromise: Promise<MathspaceModule> | null = null
function loadModule(): Promise<MathspaceModule> {
  const p = modulePromise ?? createMathspace()
  modulePromise = p
  return p
}

describe('wasm golden replay', () => {
  it('finds the committed fixtures', () => {
    expect(fixtureNames).toContain('noop')
    expect(fixtureNames).toContain('one-brush')
  })

  for (const name of fixtureNames) {
    it(`${name}: the bridged engine reproduces every committed checkpoint hash`, async () => {
      const mod = await loadModule()
      const fixture = parseActions(readFileSync(join(GOLDEN_DIR, `${name}.actions`), 'utf8'))
      const got = replay(mod, fixture)
      if (WRITE) writeFileSync(join(GOLDEN_DIR, `${name}.sha256`), formatSha256(got))
      const golden = parseSha256(readFileSync(join(GOLDEN_DIR, `${name}.sha256`), 'utf8'))
      expect(golden.length).toBeGreaterThan(0)
      expect(got).toEqual(golden)
    })
  }

  it('encodeDefineBrush(INK_BRUSH, 1) equals the action 0 bytes of one-brush.actions', () => {
    const fixture = parseActions(readFileSync(join(GOLDEN_DIR, 'one-brush.actions'), 'utf8'))
    const action0 = fixture.actions.find((a) => a.tick === 0)
    expect(action0).toBeDefined()
    expect(hexOf(encodeDefineBrush(INK_BRUSH, 1))).toBe(hexOf(action0!.bytes))
  })

  it('a rejected action leaves the hash unchanged', async () => {
    const mod = await loadModule()
    const sim = new MsSim(mod, 42n)
    try {
      const before = hexOf(sim.hash())
      expect(sim.apply(encodeDefineBrush(INK_BRUSH, 2))).toBe(5) // DD_ERR_BRUSH_ID
      expect(hexOf(sim.hash())).toBe(before)
      expect(sim.tick()).toBe(0)
    } finally {
      sim.destroy()
    }
  })
})
