/**
 * SpaceService against the real addon: two launches of the space.
 *
 * The first launch imports a hand-written v1 settings.json into a new forest
 * and Tapestry tree; a drop is one signed forest commit; a second launch puts
 * every frame back from the forest alone, even when settings.json `trees`
 * holds different numbers (SC-2). These are exactly the calls index.ts makes
 * (Plan 03), which cannot be tested itself because it imports Electron.
 *
 * Every path is injected under a temp directory: the space folder, the
 * settings folder and last-opened.json. Nothing here touches `~/Documents`
 * or the real userData (T-2.6-DATA). Each temp world gets a distinct name,
 * because two worlds created with one name in the same second share an id.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { humanActor } from '../commands/actor'
import { KernelBridge } from '../kernel-bridge'
import { SettingsStore } from '../settings'
import { TreeRegistry } from '../trees/registry'
import type { SpacePaths } from './migrate'
import { SpaceService } from './space-service'
import { HOME_FOREST_TYPE, HOME_ROOT_TYPE, MEMBER_TYPE, SPACE_TYPE } from './shapes'

const dirs: string[] = []
const registries: TreeRegistry[] = []
const services: SpaceService[] = []

afterEach(() => {
  while (services.length > 0) services.pop()!.close()
  while (registries.length > 0) {
    try {
      registries.pop()!.closeAll()
    } catch {
      // Already closed.
    }
  }
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

let worldCounter = 0

/** Create a world with a distinct name and release it again. */
function makeWorld(dir: string, file: string): string {
  const path = join(dir, file)
  const bridge = new KernelBridge()
  worldCounter += 1
  bridge.create(path, `${file.replace(/\.tree$/, '')}-${process.pid}-${worldCounter}`)
  bridge.close()
  return path
}

function commitCount(text: string): number {
  return (text.match(/^@commit /gm) ?? []).length
}

interface Rig {
  dir: string
  settings: SettingsStore
  paths: SpacePaths
  registry: TreeRegistry
  service: SpaceService
}

/** A temp folder with settings.json holding `raw`, and a service over it. */
function rig(raw: Record<string, unknown>, opts: { spaceDir?: string } = {}): Rig {
  const dir = makeTempDir('space')
  dirs.push(dir)
  const settingsDir = join(dir, 'userData')
  mkdirSync(settingsDir)
  const settings = new SettingsStore(settingsDir)
  writeFileSync(settings.path, JSON.stringify(raw, null, 2), 'utf-8')

  const spaceDir = opts.spaceDir ?? join(dir, 'space')
  const paths: SpacePaths = {
    forest: join(spaceDir, 'Forest.tree'),
    home: join(spaceDir, 'Tapestry.tree'),
    lastOpenedFile: join(settingsDir, 'last-opened.json'),
  }
  return { dir, settings, paths, ...relaunch(settings, paths) }
}

/** A fresh registry and service over the same files, as a relaunch would make. */
function relaunch(
  settings: SettingsStore,
  paths: SpacePaths,
): { registry: TreeRegistry; service: SpaceService } {
  const registry = new TreeRegistry()
  registries.push(registry)
  const service = new SpaceService({ registry, settings, paths })
  services.push(service)
  return { registry, service }
}

/** The case A fixture: two native worlds, one vault entry, one malformed entry. */
function v1Fixture(dir: string): { raw: Record<string, unknown>; alpha: string; beta: string } {
  const alpha = makeWorld(dir, 'alpha.tree')
  const beta = makeWorld(dir, 'beta.tree')
  const raw = {
    version: 1,
    userName: 'kaelen',
    agentsEnabled: true,
    trees: [
      { path: alpha, kind: 'native', frame: { x: -245.01090741236075, y: -65.50898866060388 } },
      {
        path: join(dir, 'Vault', 'Vault.tree'),
        kind: 'vault',
        vaultRoot: join(dir, 'Vault'),
        frame: { x: 1378.6410165714733, y: -123.50898866060388 },
      },
      { path: 'relative.tree', kind: 'native', frame: { x: 1, y: 2 } },
      { path: beta, kind: 'native', frame: { x: 800, y: 12.5 } },
    ],
  }
  return { raw, alpha, beta }
}

/** A rig whose settings hold the case A fixture. */
function importRig(): Rig & { alpha: string; beta: string; raw: Record<string, unknown> } {
  const worldsDir = makeTempDir('space-worlds')
  dirs.push(worldsDir)
  const { raw, alpha, beta } = v1Fixture(worldsDir)
  return { ...rig(raw), alpha, beta, raw }
}

function frameOf(service: SpaceService, path: string): { x: number; y: number } | undefined {
  return service.list().find((t) => t.path === resolve(path))?.frame
}

function idOf(service: SpaceService, path: string): string {
  const entry = service.list().find((t) => t.path === resolve(path))
  if (!entry) throw new Error(`not listed: ${path}`)
  return entry.id
}

// ---------------------------------------------------------------------------
// Case A
// ---------------------------------------------------------------------------

describe('SpaceService first launch (case A)', () => {
  it('imports the settings arrangement into a forest and a Tapestry tree, then writes the pointer', async () => {
    const r = importRig()
    const before = JSON.parse(readFileSync(r.settings.path, 'utf-8'))

    const { problem, restored } = await r.service.start()

    expect(problem).toBeNull()
    expect(r.service.ready).toBe(true)
    // Two native members open; the vault member stays in the forest unopened.
    expect(restored).toBe(2)
    expect(existsSync(r.paths.forest)).toBe(true)
    expect(existsSync(r.paths.home)).toBe(true)

    const forestText = readFileSync(r.paths.forest, 'utf-8')
    expect(forestText).toContain(' placement')
    expect(forestText).toContain('origin.x real')
    expect(forestText).toContain('origin.y real')
    expect(forestText).toContain(SPACE_TYPE)
    expect(forestText).toContain(MEMBER_TYPE)
    expect(forestText).toContain('actor system tapestry')
    expect(forestText).toContain(
      'import 3 trees and their frames from settings.json; skipped 1 unreadable entries',
    )
    expect(forestText).toContain('vault.root.hint')
    expect(commitCount(forestText)).toBe(1)

    const homeText = readFileSync(r.paths.home, 'utf-8')
    expect(homeText).toContain(HOME_ROOT_TYPE)
    expect(homeText).toContain(HOME_FOREST_TYPE)
    expect(homeText).toContain('actor system tapestry')
    expect(homeText).toContain('create Tapestry tree referencing Forest.tree')
    expect(commitCount(homeText)).toBe(1)

    const after = JSON.parse(readFileSync(r.settings.path, 'utf-8'))
    expect(after.version).toBe(2)
    expect(after.tapestry).toEqual({ path: r.paths.home })
    expect(after.trees).toEqual(before.trees)
    expect(after.userName).toBe('kaelen')

    const trees = r.raw.trees as Array<{ frame: { x: number; y: number } }>
    expect(frameOf(r.service, r.alpha)).toEqual(trees[0].frame)
    expect(frameOf(r.service, r.beta)).toEqual(trees[3].frame)
  })

  it('returns setup-failed and leaves settings.json byte-identical when the folder cannot be made', async () => {
    const dir = makeTempDir('space-blocked')
    dirs.push(dir)
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'a regular file where a folder should go', 'utf-8')
    const { raw } = v1Fixture(dir)

    const r = rig(raw, { spaceDir: join(blocker, 'space') })
    const before = readFileSync(r.settings.path)

    const { problem, restored } = await r.service.start()

    expect(problem?.kind).toBe('setup-failed')
    expect(restored).toBe(0)
    expect(r.service.ready).toBe(false)
    expect(readFileSync(r.settings.path).equals(before)).toBe(true)
    expect(r.registry.summary()).toEqual([])
  })

  it('folds last-opened.json in as one member at (0, 0), with real origins, when trees is empty', async () => {
    const worlds = makeTempDir('space-last')
    dirs.push(worlds)
    const only = makeWorld(worlds, 'only.tree')
    const r = rig({ version: 1, userName: 'kaelen', agentsEnabled: true, trees: [] })
    writeFileSync(r.paths.lastOpenedFile, JSON.stringify({ path: only }), 'utf-8')

    const { problem } = await r.service.start()

    expect(problem).toBeNull()
    expect(frameOf(r.service, only)).toEqual({ x: 0, y: 0 })
    expect(JSON.parse(readFileSync(r.settings.path, 'utf-8')).trees).toEqual([])

    r.service.close()
    const reader = new KernelBridge()
    try {
      reader.open(r.paths.forest)
      const edges = reader.getEdges()
      expect(edges).toHaveLength(1)
      // Pitfall 3: an untyped 0 would be written as an int.
      expect(edges[0].props['origin.x'].type).toBe('real')
      expect(edges[0].props['origin.y'].type).toBe('real')
    } finally {
      reader.close()
    }
  })

  it('never writes a size key', async () => {
    const r = importRig()
    await r.service.start()
    expect(readFileSync(r.paths.forest, 'utf-8')).not.toContain('size.')
  })
})

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

describe('SpaceService.moveFrames', () => {
  it('records one drop as exactly one commit signed by the person', async () => {
    const r = importRig()
    await r.service.start()
    const before = commitCount(readFileSync(r.paths.forest, 'utf-8'))

    const result = r.service.moveFrames(
      [
        { treeId: idOf(r.service, r.alpha), x: 40, y: 12.5 },
        { treeId: idOf(r.service, r.beta), x: 900, y: -30 },
      ],
      humanActor('kaelen'),
    )

    expect(result).toEqual({ committed: true })
    const text = readFileSync(r.paths.forest, 'utf-8')
    expect(commitCount(text)).toBe(before + 1)
    const lastCommit = text.slice(text.lastIndexOf('@commit '))
    expect(lastCommit).toContain('actor human user.kaelen')
    // The file escapes the quotes inside a message.
    expect(lastCommit).toContain('message "move frame \\"alpha\\" and push 1 aside"')
    expect(frameOf(r.service, r.alpha)).toEqual({ x: 40, y: 12.5 })
    expect(frameOf(r.service, r.beta)).toEqual({ x: 900, y: -30 })
  })

  it('writes nothing for a drop that changes nothing', async () => {
    const r = importRig()
    await r.service.start()
    const before = readFileSync(r.paths.forest, 'utf-8')
    const frame = frameOf(r.service, r.alpha)!

    const result = r.service.moveFrames(
      [{ treeId: idOf(r.service, r.alpha), x: frame.x, y: frame.y }],
      humanActor('kaelen'),
    )

    expect(result).toEqual({ committed: false })
    expect(readFileSync(r.paths.forest, 'utf-8')).toBe(before)
  })

  it('refuses a malformed batch and writes nothing', async () => {
    const r = importRig()
    await r.service.start()
    const alpha = idOf(r.service, r.alpha)
    const beta = idOf(r.service, r.beta)
    const before = readFileSync(r.paths.forest, 'utf-8')
    const kaelen = humanActor('kaelen')

    const bad: unknown[] = [
      { treeId: alpha, x: 1, y: 1 },
      [],
      [null],
      [{ treeId: 7, x: 1, y: 1 }],
      [{ treeId: alpha, x: Number.NaN, y: 1 }],
      [{ treeId: alpha, x: 1, y: Number.POSITIVE_INFINITY }],
      [{ treeId: alpha, x: '1', y: 1 }],
      [
        { treeId: alpha, x: 1, y: 1 },
        { treeId: alpha, x: 2, y: 2 },
      ],
      [{ treeId: 'sha256:0000', x: 1, y: 1 }],
      // Three members (alpha, the vault and beta), so four moves is too many.
      [
        { treeId: alpha, x: 1, y: 1 },
        { treeId: beta, x: 2, y: 2 },
        { treeId: 'a', x: 3, y: 3 },
        { treeId: 'b', x: 4, y: 4 },
      ],
    ]
    for (const moves of bad) {
      expect(() => r.service.moveFrames(moves, kaelen)).toThrow()
    }

    expect(readFileSync(r.paths.forest, 'utf-8')).toBe(before)
  })

  it('refuses a drop while the space is not open', () => {
    const r = rig({ version: 1, trees: [] })
    expect(() => r.service.moveFrames([{ treeId: 'x', x: 0, y: 0 }], humanActor('kaelen'))).toThrow(
      "Your space isn't open",
    )
  })
})

// ---------------------------------------------------------------------------
// Relaunch (SC-2)
// ---------------------------------------------------------------------------

describe('SpaceService relaunch', () => {
  it('restores every frame from the forest alone, whatever settings.json trees says', async () => {
    const r = importRig()
    await r.service.start()
    r.service.moveFrames(
      [
        { treeId: idOf(r.service, r.alpha), x: 111, y: 222 },
        { treeId: idOf(r.service, r.beta), x: -333, y: 444.25 },
      ],
      humanActor('kaelen'),
    )
    r.service.close()
    r.registry.closeAll()

    // Rewrite the backup list with different frames, keeping the pointer.
    const raw = JSON.parse(readFileSync(r.settings.path, 'utf-8'))
    raw.trees = raw.trees.map((t: { frame?: unknown }) =>
      typeof t === 'object' && t && 'frame' in t ? { ...t, frame: { x: 9999, y: 9999 } } : t,
    )
    writeFileSync(r.settings.path, JSON.stringify(raw, null, 2), 'utf-8')
    const forestBefore = readFileSync(r.paths.forest, 'utf-8')

    const second = relaunch(r.settings, r.paths)
    const { problem, restored } = await second.service.start()

    expect(problem).toBeNull()
    expect(restored).toBe(2)
    expect(frameOf(second.service, r.alpha)).toEqual({ x: 111, y: 222 })
    expect(frameOf(second.service, r.beta)).toEqual({ x: -333, y: 444.25 })
    // Reopening writes nothing: no second import, no new commit.
    expect(readFileSync(r.paths.forest, 'utf-8')).toBe(forestBefore)
    expect(commitCount(readFileSync(r.paths.home, 'utf-8'))).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Isolation and identity on disk
// ---------------------------------------------------------------------------

describe('SpaceService isolation', () => {
  it('keeps the forest and the Tapestry tree out of the registry', async () => {
    const r = importRig()
    await r.service.start()

    const paths = [resolve(r.paths.forest), resolve(r.paths.home)]
    expect(r.registry.list().some((t) => paths.includes(t.path))).toBe(false)
    expect(r.registry.summary().some((t) => paths.includes(t.path))).toBe(false)

    const spaceTypes = [SPACE_TYPE, MEMBER_TYPE, HOME_ROOT_TYPE, HOME_FOREST_TYPE]
    const nodes = r.registry.primaryBridgeProxy().getNodes()
    expect(nodes.some((n) => spaceTypes.includes(n.type))).toBe(false)

    expect(() => r.registry.resolveRef('Forest')).toThrow()
    expect(() => r.registry.resolveRef('Tapestry')).toThrow()
  })

  it('imports a member whose file is gone, lists it unavailable, moves it by its path id, and never writes that id', async () => {
    const worlds = makeTempDir('space-gone')
    dirs.push(worlds)
    const present = makeWorld(worlds, 'present.tree')
    const gone = join(worlds, 'gone.tree')
    const r = rig({
      version: 1,
      userName: 'kaelen',
      trees: [
        { path: present, kind: 'native', frame: { x: 0, y: 0 } },
        { path: gone, kind: 'native', frame: { x: 5, y: 6 } },
      ],
    })

    await r.service.start()

    const listed = r.service.list().find((t) => t.path === resolve(gone))
    expect(listed?.status).toBe('missing')
    expect(listed?.id.startsWith('path:')).toBe(true)
    expect(listed?.frame).toEqual({ x: 5, y: 6 })

    const result = r.service.moveFrames([{ treeId: listed!.id, x: 50, y: 60 }], humanActor('kaelen'))

    expect(result).toEqual({ committed: true })
    expect(frameOf(r.service, gone)).toEqual({ x: 50, y: 60 })
    expect(readFileSync(r.paths.forest, 'utf-8')).not.toContain('path:')
  })
})
