/**
 * PluginHost.registerSurface (CANV-04, host half).
 *
 * A surface entry is joined into a filesystem path and later served over
 * tapestry-plugin://, so the host must refuse an entry that escapes the
 * plugin directory or is not a built ES module, and must refuse a second
 * plugin claiming an id already taken — naming the owner, so the person
 * reading the failure knows which plugin to fix.
 *
 * Plugins here are real directories under a temp plugins/ root, loaded with
 * the same require() path the app uses. The kernel bridge is a stub object:
 * the facade is built lazily and nothing in these plugins submits.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { PluginHost } from './plugin-host'
import { makeTempDir } from '../../test/helpers/temp-tree'

interface SurfaceSpec {
  id: string
  displayName?: string
  entry: string
  placement?: string
}

/** Write a plugin directory whose activate() registers the given surfaces. */
function writePlugin(
  pluginsDir: string,
  dir: string,
  surfaces: SurfaceSpec[],
  opts: { manifestSurfaces?: boolean } = {},
): void {
  const pluginDir = join(pluginsDir, dir)
  mkdirSync(pluginDir, { recursive: true })
  const contributions: Record<string, unknown> = { nodeTypes: [], commands: [] }
  if (opts.manifestSurfaces !== false) {
    contributions.surfaces = surfaces.map((s) => s.id)
  }
  writeFileSync(
    join(pluginDir, 'tapestry.plugin.json'),
    JSON.stringify({
      name: dir,
      version: '1',
      displayName: `Plugin ${dir}`,
      main: 'index.js',
      api: '1',
      contributions,
    }),
  )
  const registrations = surfaces
    .map(
      (s) =>
        `context.registerSurface(${JSON.stringify({
          id: s.id,
          displayName: s.displayName ?? s.id,
          entry: s.entry,
          placement: s.placement ?? 'stage',
        })})`,
    )
    .join('\n    ')
  writeFileSync(
    join(pluginDir, 'index.js'),
    `module.exports = {
  name: ${JSON.stringify(dir)},
  version: '1',
  activate(context) {
    ${registrations}
  },
  deactivate() {},
}
`,
  )
}

/** Truthy stand-in: loadPlugin refuses a null bridge; nothing here submits. */
const stubBridge = { isLoaded: false }

describe('PluginHost.registerSurface', () => {
  let pluginsDir: string

  afterEach(() => {
    rmSync(pluginsDir, { recursive: true, force: true })
  })

  it('stores the contribution and getContributions().surfaces carries pluginName', async () => {
    pluginsDir = makeTempDir('surface-ok')
    writePlugin(pluginsDir, 'painter', [
      { id: 'painter.canvas', displayName: 'Painter', entry: 'surface/dist/surface.js' },
    ])
    const host = new PluginHost(pluginsDir)

    await host.discoverAndLoadAll(stubBridge)

    expect(host.list().find((p) => p.id === 'painter')?.status).toBe('loaded')
    expect(host.getContributions().surfaces).toEqual({
      'painter.canvas': {
        id: 'painter.canvas',
        displayName: 'Painter',
        entry: 'surface/dist/surface.js',
        placement: 'stage',
        pluginName: 'painter',
      },
    })
    expect(host.list().find((p) => p.id === 'painter')?.surfaces).toEqual(['painter.canvas'])
  })

  it('fails a second plugin registering the same surface id, naming the first owner', async () => {
    pluginsDir = makeTempDir('surface-collision')
    // Discovery is sorted by directory name: "a-first" loads before "b-second".
    writePlugin(pluginsDir, 'a-first', [{ id: 'shared.surface', entry: 'dist/a.js' }])
    writePlugin(pluginsDir, 'b-second', [{ id: 'shared.surface', entry: 'dist/b.js' }])
    const host = new PluginHost(pluginsDir)

    await host.discoverAndLoadAll(stubBridge)

    const second = host.list().find((p) => p.id === 'b-second')
    expect(second?.status).toBe('failed')
    expect(second?.reason).toBe('Surface shared.surface is already registered by plugin a-first')
    expect(host.getContributions().surfaces['shared.surface']?.pluginName).toBe('a-first')
  })

  it('rejects an entry that escapes the plugin directory', async () => {
    pluginsDir = makeTempDir('surface-escape')
    writePlugin(pluginsDir, 'escaper', [{ id: 'escaper.surface', entry: '../outside.js' }])
    const host = new PluginHost(pluginsDir)

    await host.discoverAndLoadAll(stubBridge)

    const plugin = host.list().find((p) => p.id === 'escaper')
    expect(plugin?.status).toBe('failed')
    expect(plugin?.reason).toContain('escapes plugin directory')
    expect(host.getContributions().surfaces).toEqual({})
  })

  it('rejects an entry that is not a built .js/.mjs module', async () => {
    pluginsDir = makeTempDir('surface-ts')
    writePlugin(pluginsDir, 'unbuilt', [{ id: 'unbuilt.surface', entry: 'surface/main.ts' }])
    const host = new PluginHost(pluginsDir)

    await host.discoverAndLoadAll(stubBridge)

    const plugin = host.list().find((p) => p.id === 'unbuilt')
    expect(plugin?.status).toBe('failed')
    expect(plugin?.reason).toContain('build the plugin first')
    expect(host.getContributions().surfaces).toEqual({})
  })

  it('still loads a plugin whose manifest omits contributions.surfaces', async () => {
    pluginsDir = makeTempDir('surface-legacy')
    writePlugin(pluginsDir, 'legacy', [], { manifestSurfaces: false })
    const host = new PluginHost(pluginsDir)

    await host.discoverAndLoadAll(stubBridge)

    const plugin = host.list().find((p) => p.id === 'legacy')
    expect(plugin?.status).toBe('loaded')
    expect(plugin?.surfaces).toEqual([])
    expect(host.getContributions().surfaces).toEqual({})
  })
})
