/**
 * Forest membership against the real addon (2.6 Plan 04 Task 1).
 *
 * Adding a tree writes its stand-in and placement in one commit signed by the
 * person, and the system records its identity on first open. Closing it
 * deletes the stand-in, and with it the placement, in one commit signed by the
 * person, so the last position stays in history. A relaunch restores exactly
 * the members the forest holds, and writes nothing once every digest is known.
 *
 * Every path is injected under a temp directory (T-2.6-DATA). Each temp world
 * gets a distinct name, because two worlds created with one name in the same
 * second share an id.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { humanActor } from '../commands/actor'
import { KernelBridge } from '../kernel-bridge'
import { SettingsStore } from '../settings'
import { TreeRegistry } from '../trees/registry'
import { SPACE_NOT_OPEN, type SpacePaths } from './migrate'
import { SpaceService, type SpaceServiceHooks } from './space-service'
import { MEMBER_TYPE } from './shapes'

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

const KAELEN = humanActor('kaelen')

let worldCounter = 0

/** A world name no other temp world in this run shares. */
function uniqueWorld(stem: string): string {
  worldCounter += 1
  return `${stem}-${process.pid}-${worldCounter}`
}

/** Create a world with a distinct name and release it again. */
function makeWorld(dir: string, file: string): string {
  const path = join(dir, file)
  const bridge = new KernelBridge()
  bridge.create(path, uniqueWorld(file.replace(/\.tree$/, '')))
  bridge.close()
  return path
}

/** The `@commit` records of a forest's text, in order. */
function commits(text: string): string[] {
  return text.split(/^(?=@commit )/m).filter((part) => part.startsWith('@commit '))
}

interface Rig {
  dir: string
  worlds: string
  settings: SettingsStore
  paths: SpacePaths
  registry: TreeRegistry
  service: SpaceService
  alpha: string
}

/** A fresh registry and service over the same files, as a relaunch would make. */
function relaunch(
  settings: SettingsStore,
  paths: SpacePaths,
  hooks?: SpaceServiceHooks,
): { registry: TreeRegistry; service: SpaceService } {
  const registry = new TreeRegistry()
  registries.push(registry)
  const service = new SpaceService({ registry, settings, paths, ...(hooks ? { hooks } : {}) })
  services.push(service)
  return { registry, service }
}

/** Case A with one native member, `alpha` at (100, 50), already launched. */
async function launched(): Promise<Rig> {
  const dir = makeTempDir('membership')
  dirs.push(dir)
  const worlds = join(dir, 'worlds')
  mkdirSync(worlds)
  const alpha = makeWorld(worlds, 'alpha.tree')

  const settingsDir = join(dir, 'userData')
  mkdirSync(settingsDir)
  const settings = new SettingsStore(settingsDir)
  writeFileSync(
    settings.path,
    JSON.stringify({
      version: 1,
      userName: 'kaelen',
      trees: [{ path: alpha, kind: 'native', frame: { x: 100, y: 50 } }],
    }),
    'utf-8',
  )
  const spaceDir = join(dir, 'space')
  const paths: SpacePaths = {
    forest: join(spaceDir, 'Forest.tree'),
    home: join(spaceDir, 'Tapestry.tree'),
    lastOpenedFile: join(settingsDir, 'last-opened.json'),
  }
  const { registry, service } = relaunch(settings, paths)
  const { problem } = await service.start()
  expect(problem).toBeNull()
  return { dir, worlds, settings, paths, registry, service, alpha }
}

function forestText(r: { paths: SpacePaths }): string {
  return readFileSync(r.paths.forest, 'utf-8')
}

function listed(service: SpaceService, path: string) {
  return service.list().find((t) => t.path === resolve(path))
}

/** Close everything and read the forest with a fresh bridge. */
function readClosedForest<T>(r: Rig, read: (bridge: KernelBridge) => T): T {
  r.service.close()
  r.registry.closeAll()
  const reader = new KernelBridge()
  try {
    reader.open(r.paths.forest)
    return read(reader)
  } finally {
    reader.close()
  }
}

// ---------------------------------------------------------------------------
// Adding
// ---------------------------------------------------------------------------

describe('SpaceService.addMember', () => {
  it('writes the stand-in signed by the person, then the identity signed by the system', async () => {
    const r = await launched()
    const before = commits(forestText(r)).length
    const gammaPath = join(r.worlds, 'gamma.tree')
    const gamma = r.registry.create(gammaPath, uniqueWorld('gamma'), { kind: 'native' })

    const result = r.service.addMember(gamma, KAELEN)

    expect(result).toEqual({ committed: true })
    const all = commits(forestText(r))
    expect(all).toHaveLength(before + 2)
    const [add, identity] = all.slice(-2)
    expect(add).toContain('actor human user.kaelen')
    expect(add).toContain('message "add tree \\"gamma\\""')
    expect(add).toContain(MEMBER_TYPE)
    expect(identity).toContain('actor system tapestry')
    expect(identity).toContain('message "record identity of \\"gamma\\""')
    expect(identity).toContain(gamma.id)

    // Right of alpha by FRAME_MIN_WIDTH + FRAME_GAP, at alpha's height.
    expect(listed(r.service, gammaPath)?.frame).toEqual({ x: 100 + 544, y: 50 })
    expect(listed(r.service, gammaPath)?.id).toBe(gamma.id)
    expect(forestText(r)).not.toContain('path:')

    const { standIn, placementTypes } = readClosedForest(r, (reader) => {
      const node = reader
        .getNodes()
        .find((n) => n.type === MEMBER_TYPE && n.props['path.hint']?.value === resolve(gammaPath))
      const edge = reader.getEdges().find((e) => e.to === node?.id)
      return {
        standIn: node,
        placementTypes: [edge?.props['origin.x']?.type, edge?.props['origin.y']?.type],
      }
    })
    expect(standIn?.props.kind?.value).toBe('native')
    expect(standIn?.props.digest?.value).toBe(gamma.id)
    expect(placementTypes).toEqual(['real', 'real'])
  })

  it('writes nothing when the same open tree is added again', async () => {
    const r = await launched()
    const gamma = r.registry.create(join(r.worlds, 'gamma.tree'), uniqueWorld('gamma'), {
      kind: 'native',
    })
    r.service.addMember(gamma, KAELEN)
    const before = forestText(r)

    expect(r.service.addMember(gamma, KAELEN)).toEqual({ committed: false })
    const alpha = r.registry.list().find((t) => t.path === resolve(r.alpha))!
    expect(r.service.addMember(alpha, KAELEN)).toEqual({ committed: false })

    expect(forestText(r)).toBe(before)
  })

  it('adds a missing path with one human commit and no digest, and never writes its path: id', async () => {
    const r = await launched()
    const before = commits(forestText(r)).length
    const gone = join(r.worlds, 'gone.tree')
    const entry = r.registry.tryOpen(gone, { kind: 'native' })
    expect(entry.id.startsWith('path:')).toBe(true)

    expect(r.service.addMember(entry, KAELEN)).toEqual({ committed: true })

    const all = commits(forestText(r))
    expect(all).toHaveLength(before + 1)
    expect(all.at(-1)).toContain('actor human user.kaelen')
    expect(all.at(-1)).toContain('message "add tree \\"gone\\""')
    expect(all.at(-1)).not.toContain('digest')
    expect(forestText(r)).not.toContain('path:')
    expect(listed(r.service, gone)?.status).toBe('missing')
    expect(listed(r.service, gone)?.frame).toEqual({ x: 644, y: 50 })
  })

  it('refuses with the approved wording while the space is not open', () => {
    const registry = new TreeRegistry()
    registries.push(registry)
    const dir = makeTempDir('membership-closed')
    dirs.push(dir)
    const settings = new SettingsStore(dir)
    const service = new SpaceService({
      registry,
      settings,
      paths: {
        forest: join(dir, 'Forest.tree'),
        home: join(dir, 'Tapestry.tree'),
        lastOpenedFile: join(dir, 'last-opened.json'),
      },
    })
    services.push(service)
    const entry = registry.tryOpen(join(dir, 'nothing.tree'))

    expect(() => service.addMember(entry, KAELEN)).toThrow(SPACE_NOT_OPEN)
    expect(() => service.removeMember(entry.id, KAELEN)).toThrow(SPACE_NOT_OPEN)
  })
})

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

describe('SpaceService.removeMember', () => {
  it('deletes the stand-in in one human commit, keeps the frame in history, and stays gone after a relaunch', async () => {
    const r = await launched()
    const gammaPath = join(r.worlds, 'gamma.tree')
    const gamma = r.registry.create(gammaPath, uniqueWorld('gamma'), { kind: 'native' })
    r.service.addMember(gamma, KAELEN)
    const before = commits(forestText(r)).length

    expect(r.service.removeMember(gamma.id, KAELEN)).toEqual({ committed: true })
    r.registry.close(gamma.id)

    const all = commits(forestText(r))
    expect(all).toHaveLength(before + 1)
    expect(all.at(-1)).toContain('actor human user.kaelen')
    expect(all.at(-1)).toContain('message "remove tree \\"gamma\\" from the forest"')
    expect(all.at(-1)).toContain('delete-node')
    expect(listed(r.service, gammaPath)).toBeUndefined()

    // A tree that is not a member writes nothing.
    expect(r.service.removeMember('sha256:' + '0'.repeat(64), KAELEN)).toEqual({ committed: false })
    expect(commits(forestText(r))).toHaveLength(before + 1)

    const { live, history } = readClosedForest(r, (reader) => {
      const placements = reader.getEdges().filter((e) => e.label === 'placement')
      return {
        live: reader
          .getNodes()
          .filter((n) => n.type === MEMBER_TYPE)
          .map((n) => n.props['path.hint']?.value),
        history: { edges: reader.getHistoryIndex().edges, placements: placements.length },
      }
    })
    expect(live).toEqual([resolve(r.alpha)])
    expect(history.placements).toBe(1)
    const deleted = Object.values(history.edges).filter((e) => e.deletedBy !== null)
    expect(deleted).toHaveLength(1)
    expect(deleted[0].deletedBy).toEqual({ kind: 'human', id: 'user.kaelen' })

    const second = relaunch(r.settings, r.paths)
    await second.service.start()
    expect(listed(second.service, gammaPath)).toBeUndefined()
    expect(second.service.list().map((t) => t.path)).toEqual([resolve(r.alpha)])
  })
})

// ---------------------------------------------------------------------------
// Vault members
// ---------------------------------------------------------------------------

describe('vault members', () => {
  it('round-trips kind, vault root and name through the forest and the restoreVault hook', async () => {
    const r = await launched()
    const vaultRoot = join(r.worlds, 'Garden')
    mkdirSync(vaultRoot)
    const treePath = join(vaultRoot, 'Garden.tree')
    const vault = r.registry.create(treePath, uniqueWorld('Garden'), {
      kind: 'vault',
      vaultRoot,
      name: 'Garden',
    })

    r.service.addMember(vault, KAELEN)
    const before = listed(r.service, treePath)!
    expect(before.kind).toBe('vault')
    expect(forestText(r)).toContain('vault.root.hint')
    r.service.close()
    r.registry.closeAll()

    const calls: Array<{ treePath: string; vaultRoot: string; name: string }> = []
    let registry!: TreeRegistry
    const second = relaunch(r.settings, r.paths, {
      restoreVault: async (req) => {
        calls.push({ treePath: req.treePath, vaultRoot: req.vaultRoot, name: req.name })
        // The recorded digest travels with the request (Plan 04 Task 2).
        expect(req.expect?.id).toBe(before.id)
        registry.tryOpen(req.treePath, {
          kind: 'vault',
          vaultRoot: req.vaultRoot,
          name: req.name,
          ...(req.expect ? { expect: req.expect } : {}),
        })
      },
    })
    registry = second.registry
    const forestBefore = forestText(r)

    await second.service.start()

    expect(calls).toEqual([{ treePath: resolve(treePath), vaultRoot: resolve(vaultRoot), name: 'Garden' }])
    const after = listed(second.service, treePath)!
    expect(after).toEqual(
      expect.objectContaining({
        id: before.id,
        kind: before.kind,
        vaultRoot: before.vaultRoot,
        name: before.name,
        frame: before.frame,
        status: 'ok',
      }),
    )
    // Its digest was recorded when it was added, so the relaunch writes nothing.
    expect(forestText(r)).toBe(forestBefore)
  })
})

// ---------------------------------------------------------------------------
// Relaunch
// ---------------------------------------------------------------------------

describe('identity on first launch', () => {
  it('records a digest-less member once, signed by the system, and a second launch writes nothing', async () => {
    const r = await launched()
    const all = commits(forestText(r))

    // The import, then the one identity commit for alpha.
    expect(all).toHaveLength(2)
    expect(all[0]).toContain('actor system tapestry')
    expect(all[0]).toContain('import 1 trees')
    expect(all[1]).toContain('actor system tapestry')
    expect(all[1]).toContain('message "record identity of \\"alpha\\""')
    const alphaId = r.registry.list()[0].id
    expect(all[1]).toContain(alphaId)

    r.service.close()
    r.registry.closeAll()
    const before = forestText(r)

    const second = relaunch(r.settings, r.paths)
    const { problem, restored } = await second.service.start()

    expect(problem).toBeNull()
    expect(restored).toBe(1)
    expect(forestText(r)).toBe(before)
    expect(listed(second.service, r.alpha)?.frame).toEqual({ x: 100, y: 50 })
  })
})
