/**
 * A member is its header digest (2.6 D-03, SC-4), against the real addon.
 *
 * A moved file keeps its frame when the person opens it from its new path.
 * A copy of an open world is refused, and a different world at a member's
 * path is shown unavailable and never adopted; neither writes anything. Two
 * stand-ins that turn out to be one world are folded into one by a single
 * system commit naming both. Tapestry's own forest and Tapestry tree, or a
 * copy of either, cannot be added.
 *
 * Odd forests that no user flow produces are built directly with
 * `ForestStore.createWithMembers`. Files are moved and copied only after
 * their bridges are closed. Every path is injected under a temp directory
 * (T-2.6-DATA).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { SYSTEM_ACTOR, humanActor } from '../commands/actor'
import { KernelBridge } from '../kernel-bridge'
import { SettingsStore } from '../settings'
import { TreeIdentityClash, TreeRegistry } from '../trees/registry'
import { ForestStore, type MemberSeed } from './forest-store'
import { TapestryHome } from './home-tree'
import { differentWorldReason, reservedFileRefusal, type SpacePaths } from './migrate'
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

function uniqueWorld(stem: string): string {
  worldCounter += 1
  return `${stem}-${process.pid}-${worldCounter}`
}

/** Create a world with a distinct name, release it, and return its path and digest. */
function makeWorld(dir: string, file: string): { path: string; digest: string } {
  const path = join(dir, file)
  const bridge = new KernelBridge()
  bridge.create(path, uniqueWorld(file.replace(/\.tree$/, '')))
  const digest = bridge.getHeaderDigest()
  bridge.close()
  return { path, digest }
}

function commitCount(text: string): number {
  return (text.match(/^@commit /gm) ?? []).length
}

function lastCommit(text: string): string {
  return text.slice(text.lastIndexOf('@commit '))
}

function standInCount(text: string): number {
  return text.split(MEMBER_TYPE).length - 1
}

interface Space {
  dir: string
  worlds: string
  settings: SettingsStore
  paths: SpacePaths
}

/** A temp folder with a worlds folder and a settings store; no space yet. */
function folder(): Space {
  const dir = makeTempDir('identity')
  dirs.push(dir)
  const worlds = join(dir, 'worlds')
  mkdirSync(worlds)
  const settingsDir = join(dir, 'userData')
  mkdirSync(settingsDir)
  const settings = new SettingsStore(settingsDir)
  const spaceDir = join(dir, 'space')
  return {
    dir,
    worlds,
    settings,
    paths: {
      forest: join(spaceDir, 'Forest.tree'),
      home: join(spaceDir, 'Tapestry.tree'),
      lastOpenedFile: join(settingsDir, 'last-opened.json'),
    },
  }
}

/** A space whose forest holds exactly `seeds`, as a hand-edit or an old bug might leave it. */
function spaceWith(space: Space, seeds: MemberSeed[]): void {
  const forest = ForestStore.createWithMembers(space.paths.forest, seeds, SYSTEM_ACTOR, 'fixture')
  const home = TapestryHome.createReferencing(
    space.paths.home,
    { digest: forest.digest(), pathHint: forest.path },
    SYSTEM_ACTOR,
    'fixture',
  )
  forest.close()
  home.close()
  space.settings.setTapestryPointer(space.paths.home)
}

/** Case A: settings.json lists `trees`, and nothing is launched yet. */
function v1Space(trees: Array<{ path: string; x: number; y: number }>): Space {
  const space = folder()
  writeFileSync(
    space.settings.path,
    JSON.stringify({
      version: 1,
      userName: 'kaelen',
      trees: trees.map((t) => ({ path: t.path, kind: 'native', frame: { x: t.x, y: t.y } })),
    }),
    'utf-8',
  )
  return space
}

function launch(
  space: Space,
  hooks?: SpaceServiceHooks,
): { registry: TreeRegistry; service: SpaceService } {
  const registry = new TreeRegistry()
  registries.push(registry)
  const service = new SpaceService({
    registry,
    settings: space.settings,
    paths: space.paths,
    ...(hooks ? { hooks } : {}),
  })
  services.push(service)
  return { registry, service }
}

function quit(run: { registry: TreeRegistry; service: SpaceService }): void {
  run.service.close()
  run.registry.closeAll()
}

function forestText(space: Space): string {
  return readFileSync(space.paths.forest, 'utf-8')
}

function pathIds(registry: TreeRegistry): string[] {
  return registry
    .summary()
    .map((t) => t.id)
    .filter((id) => id.startsWith('path:'))
}

// ---------------------------------------------------------------------------
// Moved, copied, replaced
// ---------------------------------------------------------------------------

describe('a moved file', () => {
  it('keeps its frame when the person opens it from its new path', async () => {
    const worlds = folder()
    const alpha = makeWorld(worlds.worlds, 'alpha.tree')
    const space = v1Space([{ path: alpha.path, x: 100, y: 50 }])
    const first = launch(space)
    await first.service.start()
    quit(first)

    const moved = join(worlds.worlds, 'renamed.tree')
    renameSync(alpha.path, moved)

    const second = launch(space)
    await second.service.start()
    const stale = second.service.list()
    expect(stale).toHaveLength(1)
    expect(stale[0]).toEqual(
      expect.objectContaining({ status: 'missing', path: resolve(alpha.path), frame: { x: 100, y: 50 } }),
    )
    const before = forestText(space)

    const opened = second.registry.tryOpen(moved, { kind: 'native' })
    expect(opened.id).toBe(alpha.digest)
    expect(second.service.addMember(opened, KAELEN)).toEqual({ committed: true })

    const after = forestText(space)
    expect(commitCount(after)).toBe(commitCount(before) + 1)
    expect(lastCommit(after)).toContain('actor human user.kaelen')
    expect(lastCommit(after)).toContain('message "add tree \\"renamed\\""')
    expect(lastCommit(after)).toContain(resolve(moved))
    expect(standInCount(after)).toBe(standInCount(before))
    expect(second.service.list()).toEqual([
      expect.objectContaining({ id: alpha.digest, path: resolve(moved), status: 'ok', frame: { x: 100, y: 50 } }),
    ])
    expect(pathIds(second.registry)).toEqual([])
    expect(after).not.toContain('path:')
  })
})

describe('a copy of an open world', () => {
  it('is refused by identity and writes nothing', async () => {
    const worlds = folder()
    const alpha = makeWorld(worlds.worlds, 'alpha.tree')
    const copy = join(worlds.worlds, 'alpha-copy.tree')
    copyFileSync(alpha.path, copy)
    const space = v1Space([{ path: alpha.path, x: 0, y: 0 }])
    const run = launch(space)
    await run.service.start()
    const before = forestText(space)

    expect(() => run.registry.tryOpen(copy, { kind: 'native' })).toThrow(TreeIdentityClash)

    expect(forestText(space)).toBe(before)
    expect(run.service.list()).toHaveLength(1)
  })
})

describe('a different world at a member path', () => {
  it('is listed unavailable with the approved reason, never adopted, and nothing is written', async () => {
    const worlds = folder()
    const alpha = makeWorld(worlds.worlds, 'alpha.tree')
    const space = v1Space([{ path: alpha.path, x: 7, y: 8 }])
    const first = launch(space)
    await first.service.start()
    quit(first)

    rmSync(alpha.path)
    const impostor = makeWorld(worlds.worlds, 'alpha.tree')
    expect(impostor.digest).not.toBe(alpha.digest)
    const before = forestText(space)

    const second = launch(space)
    await second.service.start()

    expect(second.service.list()).toEqual([
      expect.objectContaining({
        status: 'missing',
        reason: differentWorldReason(resolve(alpha.path)),
        frame: { x: 7, y: 8 },
      }),
    ])
    expect(second.service.list()[0].reason).toBe(
      `A different world is now at ${resolve(alpha.path)}, so this tree's file can't be found.`,
    )
    expect(second.registry.list()).toEqual([])
    expect(second.registry.get(impostor.digest)).toBeNull()
    expect(forestText(space)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Duplicate stand-ins (RESEARCH Pitfall 10)
// ---------------------------------------------------------------------------

describe('duplicate stand-ins found at launch', () => {
  it('records the first copy and folds the second away in one system commit naming both', async () => {
    const space = folder()
    const a = makeWorld(space.worlds, 'a.tree')
    const copy = join(space.worlds, 'a-copy.tree')
    copyFileSync(a.path, copy)
    spaceWith(space, [
      { kind: 'native', pathHint: a.path, origin: { x: 0, y: 0 } },
      { kind: 'native', pathHint: copy, origin: { x: 600, y: 0 } },
    ])
    const before = commitCount(forestText(space))

    const run = launch(space)
    await run.service.start()

    const text = forestText(space)
    expect(commitCount(text)).toBe(before + 2)
    const fold = lastCommit(text)
    expect(fold).toContain('actor system tapestry')
    expect(fold).toContain(
      `message "forget \\"a-copy\\" at ${resolve(copy)}: it is the same world as \\"a\\""`,
    )
    expect(fold).toContain('delete-node')
    expect(run.service.list()).toEqual([
      expect.objectContaining({ id: a.digest, path: resolve(a.path), frame: { x: 0, y: 0 } }),
    ])
    expect(pathIds(run.registry)).toEqual([])
  })

  it('moves an unavailable established member to the path that opened and drops the digest-less one', async () => {
    const space = folder()
    const a = makeWorld(space.worlds, 'a.tree')
    const gone = join(space.worlds, 'b.tree')
    spaceWith(space, [
      { kind: 'native', pathHint: gone, digest: a.digest, origin: { x: 300, y: 40 } },
      { kind: 'native', pathHint: a.path, origin: { x: 900, y: 0 } },
    ])
    const before = commitCount(forestText(space))

    const run = launch(space)
    await run.service.start()

    const text = forestText(space)
    expect(commitCount(text)).toBe(before + 1)
    const fold = lastCommit(text)
    expect(fold).toContain('actor system tapestry')
    expect(fold).toContain(
      `message "forget \\"a\\" at ${resolve(a.path)}: it is the same world as \\"b\\""`,
    )
    expect(fold).toContain('delete-node')
    expect(run.service.list()).toEqual([
      expect.objectContaining({ id: a.digest, path: resolve(a.path), status: 'ok', frame: { x: 300, y: 40 } }),
    ])
    expect(pathIds(run.registry)).toEqual([])
    expect(text).not.toContain('path:')

    // The fold is settled: a relaunch writes nothing.
    quit(run)
    const settled = forestText(space)
    const again = launch(space)
    await again.service.start()
    expect(forestText(space)).toBe(settled)
    expect(again.service.list()).toHaveLength(1)
  })

  for (const order of ['established first', 'digest-less first'] as const) {
    it(`ends with one listed entry and no stale path: entry (${order})`, async () => {
      const space = folder()
      const a = makeWorld(space.worlds, 'a.tree')
      const copy = join(space.worlds, 'a-copy.tree')
      copyFileSync(a.path, copy)
      const gone = join(space.worlds, 'gone.tree')

      const established: MemberSeed = {
        kind: 'native',
        pathHint: gone,
        digest: a.digest,
        origin: { x: 10, y: 20 },
      }
      const digestLess: MemberSeed = { kind: 'native', pathHint: a.path, origin: { x: 700, y: 0 } }
      const alsoOpen: MemberSeed = { kind: 'native', pathHint: copy, origin: { x: 1400, y: 0 } }
      spaceWith(
        space,
        order === 'established first'
          ? [established, digestLess, alsoOpen]
          : [alsoOpen, digestLess, established],
      )

      const run = launch(space)
      await run.service.start()

      const listed = run.service.list()
      expect(listed).toHaveLength(1)
      expect(listed[0]).toEqual(expect.objectContaining({ id: a.digest, status: 'ok' }))
      expect(pathIds(run.registry)).toEqual([])
      expect(forestText(space)).not.toContain('path:')
      expect(standInCount(forestText(space))).toBe(3)
    })
  }
})

// ---------------------------------------------------------------------------
// Tapestry's own files (RESEARCH Pitfall 4)
// ---------------------------------------------------------------------------

describe("Tapestry's own files", () => {
  it('cannot be added, nor can a copy of the forest, and nothing is written', async () => {
    const worlds = folder()
    const alpha = makeWorld(worlds.worlds, 'alpha.tree')
    const space = v1Space([{ path: alpha.path, x: 0, y: 0 }])
    const run = launch(space)
    await run.service.start()
    const before = forestText(space)
    const homeBefore = readFileSync(space.paths.home, 'utf-8')

    expect(() => run.registry.tryOpen(space.paths.forest, { kind: 'native' })).toThrow(
      reservedFileRefusal('Forest.tree'),
    )
    expect(() => run.registry.tryOpen(space.paths.home, { kind: 'native' })).toThrow(
      reservedFileRefusal('Tapestry.tree'),
    )
    expect(() => run.registry.create(space.paths.forest, 'Forest', { kind: 'native' })).toThrow(
      "Forest.tree is Tapestry's own arrangement file and can't be added as a tree.",
    )

    const forestCopy = join(worlds.worlds, 'Forest-copy.tree')
    copyFileSync(space.paths.forest, forestCopy)
    expect(() => run.registry.tryOpen(forestCopy, { kind: 'native' })).toThrow(
      reservedFileRefusal('Forest-copy.tree'),
    )

    expect(forestText(space)).toBe(before)
    expect(readFileSync(space.paths.home, 'utf-8')).toBe(homeBefore)
    expect(run.service.list()).toHaveLength(1)

    // Closing the space lifts the reservation with it.
    run.service.close()
    const probe = run.registry.tryOpen(forestCopy, { kind: 'native' })
    expect(probe.id).not.toBe(alpha.digest)
  })
})

// ---------------------------------------------------------------------------
// Reopen and relocate
// ---------------------------------------------------------------------------

describe('SpaceService.reopenMember', () => {
  it('records the digest once when a member locked at launch is reopened', async () => {
    const worlds = folder()
    const alpha = makeWorld(worlds.worlds, 'alpha.tree')
    const space = v1Space([{ path: alpha.path, x: 3, y: 4 }])

    const holder = new KernelBridge()
    let run!: { registry: TreeRegistry; service: SpaceService }
    try {
      holder.open(alpha.path)
      run = launch(space)
      await run.service.start()
    } finally {
      holder.close()
    }

    const locked = run.service.list()[0]
    expect(locked.status).toBe('locked')
    const before = forestText(space)
    expect(before).not.toContain(alpha.digest)

    const reopened = run.service.reopenMember(locked.id)
    expect(reopened?.id).toBe(alpha.digest)

    const after = forestText(space)
    expect(commitCount(after)).toBe(commitCount(before) + 1)
    expect(lastCommit(after)).toContain('actor system tapestry')
    expect(lastCommit(after)).toContain('message "record identity of \\"alpha\\""')
    expect(lastCommit(after)).toContain(alpha.digest)
    expect(run.service.list()).toEqual([
      expect.objectContaining({ id: alpha.digest, status: 'ok', frame: { x: 3, y: 4 } }),
    ])

    expect(run.service.reopenMember(alpha.digest)).toBeNull()
    quit(run)
    const again = launch(space)
    await again.service.start()
    expect(forestText(space)).toBe(after)
  })
})

describe('SpaceService.relocateMember', () => {
  it('updates the path hint and vault root hint in one commit signed by the person', async () => {
    const worlds = folder()
    const alpha = makeWorld(worlds.worlds, 'alpha.tree')
    const space = v1Space([{ path: alpha.path, x: 0, y: 0 }])
    const run = launch(space)
    await run.service.start()

    const root = join(worlds.worlds, 'Garden')
    mkdirSync(root)
    const vault = run.registry.create(join(root, 'Garden.tree'), uniqueWorld('Garden'), {
      kind: 'vault',
      vaultRoot: root,
      name: 'Garden',
    })
    run.service.addMember(vault, KAELEN)
    const before = forestText(space)

    const newRoot = join(worlds.worlds, 'Garden2')
    const newTree = join(newRoot, 'Garden.tree')
    expect(run.service.relocateMember(vault.id, newTree, newRoot, KAELEN)).toEqual({
      committed: true,
    })

    const after = forestText(space)
    expect(commitCount(after)).toBe(commitCount(before) + 1)
    const commit = lastCommit(after)
    expect(commit).toContain('actor human user.kaelen')
    expect(commit).toContain(`path.hint text "${resolve(newTree)}"`)
    expect(commit).toContain(`vault.root.hint text "${resolve(newRoot)}"`)

    // Relocating to where it already is writes nothing.
    expect(run.service.relocateMember(vault.id, newTree, newRoot, KAELEN)).toEqual({
      committed: false,
    })
    expect(forestText(space)).toBe(after)
  })
})
