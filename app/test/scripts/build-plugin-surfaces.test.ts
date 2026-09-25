/**
 * scripts/build-plugin-surfaces.mjs decides which plugins get their surface
 * built before the app launches. These tests cover the decision (not the
 * Vite builds themselves, which take seconds and need the plugins' Wasm).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { planSurfaceBuilds, SURFACE_SCRIPT } from '../../scripts/build-plugin-surfaces.mjs'

const REPO_PLUGINS = resolve(__dirname, '..', '..', '..', 'plugins')

let tmp: string | undefined

function makePlugin(root: string, name: string, pkg: unknown, files: string[] = []): void {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  if (pkg !== undefined) writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
  for (const f of files) {
    mkdirSync(join(dir, f, '..'), { recursive: true })
    writeFileSync(join(dir, f), '')
  }
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = undefined
})

describe('planSurfaceBuilds', () => {
  it('selects only plugins that define build:surface, in name order', () => {
    tmp = mkdtempSync(join(tmpdir(), 'surfaces-'))
    makePlugin(tmp, 'zeta', { scripts: { [SURFACE_SCRIPT]: 'vite build' } })
    makePlugin(tmp, 'alpha', { scripts: { [SURFACE_SCRIPT]: 'vite build' } })
    makePlugin(tmp, 'plain', { scripts: { build: 'tsc' } })
    makePlugin(tmp, 'no-scripts', { name: 'x' })
    makePlugin(tmp, 'no-package', undefined)

    const plans = planSurfaceBuilds(tmp)
    expect(plans.map((p) => p.name)).toEqual(['alpha', 'zeta'])
    expect(plans.every((p) => p.missing.length === 0)).toBe(true)
  })

  it('reports declared inputs that are missing, with the hint', () => {
    tmp = mkdtempSync(join(tmpdir(), 'surfaces-'))
    makePlugin(
      tmp,
      'wasmy',
      {
        scripts: { [SURFACE_SCRIPT]: 'vite build' },
        tapestrySurface: { requires: ['wasm/a.wasm', 'wasm/a.mjs'], missingHint: 'run the wasm script' },
      },
      ['wasm/a.mjs'],
    )
    const [plan] = planSurfaceBuilds(tmp)
    expect(plan.missing).toEqual(['wasm/a.wasm'])
    expect(plan.hint).toBe('run the wasm script')
  })

  it('returns nothing for a missing plugins directory', () => {
    expect(planSurfaceBuilds(join(tmpdir(), 'no-such-plugins-dir-xyz'))).toEqual([])
  })
})

describe('repository plugins', () => {
  it('every plugin whose surface entry is build output defines build:surface', () => {
    const built = new Set(planSurfaceBuilds(REPO_PLUGINS).map((p) => p.name))
    const needBuild = readdirSync(REPO_PLUGINS).filter((name) => {
      const index = join(REPO_PLUGINS, name, 'index.js')
      return existsSync(index) && /entry:\s*['"][^'"]*\/dist\//.test(readFileSync(index, 'utf8'))
    })
    expect(needBuild).toEqual(expect.arrayContaining(['data-drawing', 'mathspace']))
    for (const name of needBuild) expect(built.has(name), name).toBe(true)
  })
})
