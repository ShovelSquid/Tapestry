/**
 * Launch cases A-J (2.6 D-14, RESEARCH § Q8) against the real addon.
 *
 * These drive `SpaceService.start()`, exactly as index.ts does, through each
 * way a launch can find the space folder: a first launch (A), an upgrade that
 * lost its pointer with a Tapestry tree still there (B) or with only the
 * forest there (C), a damaged Tapestry tree (F), a newer settings file (I) and
 * a malformed `trees` entry (J). Cases E, G and H are in space-service.test.ts
 * and are not repeated here.
 *
 * Every path is injected under a temp directory (T-2.6-DATA): nothing here
 * touches `~/Documents`, the real userData or any real world. Each temp world
 * gets a distinct name, because two worlds created with one name in the same
 * second share an id. Every service and registry is closed after each test so
 * no journal lock outlives it.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { humanActor } from '../commands/actor'
import { KernelBridge } from '../kernel-bridge'
import { SettingsStore } from '../settings'
import { TreeRegistry } from '../trees/registry'
import { ForestStore } from './forest-store'
import { TapestryHome } from './home-tree'
import {
  SPACE_NOT_OPEN,
  classifySpace,
  problemMessage,
  reservedFileRefusal,
  type SpacePaths,
  type SpaceProblemKind,
} from './migrate'
import { SpaceRefusal, SpaceService } from './space-service'
import { SETTINGS_POINTER_KEY } from './shapes'

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
  mkdirSync(dir, { recursive: true })
  const bridge = new KernelBridge()
  worldCounter += 1
  bridge.create(path, `${file.replace(/\.tree$/, '')}-migrate-${process.pid}-${worldCounter}`)
  bridge.close()
  return path
}

function commitCount(path: string): number {
  return (readFileSync(path, 'utf-8').match(/^@commit /gm) ?? []).length
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

interface Rig {
  dir: string
  settings: SettingsStore
  paths: SpacePaths
  alpha: string
  beta: string
  raw: Record<string, unknown>
}

/**
 * A temp folder with a v1 settings.json holding two native worlds, one vault
 * entry and one malformed entry (the case A fixture), and the space folder
 * the service would use. Nothing is started.
 */
function rig(): Rig {
  const dir = makeTempDir('migrate')
  dirs.push(dir)
  const worlds = join(dir, 'worlds')
  const alpha = makeWorld(worlds, 'alpha.tree')
  const beta = makeWorld(worlds, 'beta.tree')
  const raw: Record<string, unknown> = {
    version: 1,
    userName: 'kaelen',
    agentsEnabled: true,
    trees: [
      { path: alpha, kind: 'native', frame: { x: -245.5, y: -65.25 } },
      {
        path: join(worlds, 'Vault', 'Vault.tree'),
        kind: 'vault',
        vaultRoot: join(worlds, 'Vault'),
        frame: { x: 1378.5, y: -123.5 },
      },
      { path: 'relative.tree', kind: 'native', frame: { x: 1, y: 2 } },
      { path: beta, kind: 'native', frame: { x: 800, y: 12.5 } },
    ],
  }

  const settingsDir = join(dir, 'userData')
  mkdirSync(settingsDir)
  const settings = new SettingsStore(settingsDir)
  writeFileSync(settings.path, JSON.stringify(raw, null, 2), 'utf-8')

  const spaceDir = join(dir, 'space')
  const paths: SpacePaths = {
    forest: join(spaceDir, 'Forest.tree'),
    home: join(spaceDir, 'Tapestry.tree'),
    lastOpenedFile: join(settingsDir, 'last-opened.json'),
  }
  return { dir, settings, paths, alpha, beta, raw }
}

/** A fresh registry and service over the rig's files, as a launch would make. */
function launch(r: Rig): { registry: TreeRegistry; service: SpaceService } {
  const registry = new TreeRegistry()
  registries.push(registry)
  const service = new SpaceService({ registry, settings: r.settings, paths: r.paths })
  services.push(service)
  return { registry, service }
}

/** Case A, then everything closed again, as a quit would leave it. */
async function importedThenQuit(r: Rig): Promise<void> {
  const { registry, service } = launch(r)
  const { problem } = await service.start()
  expect(problem).toBeNull()
  service.close()
  registry.closeAll()
}

/**
 * What an older build leaves behind: settings.json rewritten as `version: 1`
 * without the pointer, with `trees` and every other key as they were.
 */
function dropPointer(r: Rig): void {
  const raw = readJson(r.settings.path)
  delete raw[SETTINGS_POINTER_KEY]
  raw.version = 1
  writeFileSync(r.settings.path, JSON.stringify(raw, null, 2), 'utf-8')
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe('classifySpace', () => {
  it.each([
    [{ pointer: '/x/Tapestry.tree', homeExists: true, forestExists: true }, 'reopen'],
    [{ pointer: '/x/Tapestry.tree', homeExists: false, forestExists: false }, 'reopen'],
    [{ pointer: null, homeExists: true, forestExists: true }, 'recover-home'],
    [{ pointer: null, homeExists: true, forestExists: false }, 'recover-home'],
    [{ pointer: null, homeExists: false, forestExists: true }, 'recover-forest'],
    [{ pointer: null, homeExists: false, forestExists: false }, 'import'],
  ] as const)('%o is %s', (state, expected) => {
    expect(classifySpace(state)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Case A
// ---------------------------------------------------------------------------

describe('case A: first launch', () => {
  it('imports, raises version to 2, writes the pointer and leaves trees deep-equal', async () => {
    const r = rig()
    const before = readJson(r.settings.path)
    const { service } = launch(r)

    const { problem } = await service.start()

    expect(problem).toBeNull()
    expect(service.problemNotice()).toBeNull()
    const after = readJson(r.settings.path)
    expect(after.version).toBe(2)
    expect(after[SETTINGS_POINTER_KEY]).toEqual({ path: r.paths.home })
    expect(after.trees).toEqual(before.trees)
  })
})

// ---------------------------------------------------------------------------
// Case B
// ---------------------------------------------------------------------------

describe('case B: no pointer, a Tapestry tree at the default path', () => {
  it('an older build dropped the pointer: re-adds it and imports nothing', async () => {
    const r = rig()
    await importedThenQuit(r)
    const forestCommits = commitCount(r.paths.forest)
    const homeCommits = commitCount(r.paths.home)
    dropPointer(r)
    const treesBefore = readJson(r.settings.path).trees

    const { service } = launch(r)
    const { problem, restored } = await service.start()

    expect(problem).toBeNull()
    expect(service.ready).toBe(true)
    expect(restored).toBe(2)
    // B(i): no second import, so the forest's history is exactly as it was.
    expect(commitCount(r.paths.forest)).toBe(forestCommits)
    expect(commitCount(r.paths.home)).toBe(homeCommits)
    expect(readFileSync(r.paths.forest, 'utf-8').match(/import \d+ trees/g)).toHaveLength(1)

    const after = readJson(r.settings.path)
    expect(after[SETTINGS_POINTER_KEY]).toEqual({ path: r.paths.home })
    expect(after.version).toBe(2)
    expect(after.trees).toEqual(treesBefore)
  })

  it('a foreign file at the default path is home-foreign, left byte-for-byte alone, and no forest is made', async () => {
    const r = rig()
    const foreign = makeWorld(join(r.dir, 'space'), 'Tapestry.tree')
    const bytesBefore = readFileSync(foreign)
    const settingsBefore = readFileSync(r.settings.path)

    const { service, registry } = launch(r)
    const { problem, restored } = await service.start()

    expect(problem).toEqual(expect.objectContaining({ kind: 'home-foreign', path: r.paths.home }))
    expect(restored).toBe(0)
    expect(service.ready).toBe(false)
    expect(registry.summary()).toEqual([])
    expect(readFileSync(foreign).equals(bytesBefore)).toBe(true)
    expect(readFileSync(r.settings.path).equals(settingsBefore)).toBe(true)
    expect(existsSync(r.paths.forest)).toBe(false)
    expect(service.problemNotice()).toBe(
      `Tapestry.tree at ${r.paths.home} isn't a Tapestry file, so Tapestry left it alone and didn't set up your space.`,
    )
  })
})

// ---------------------------------------------------------------------------
// Case C
// ---------------------------------------------------------------------------

describe('case C: no pointer, only a forest at the default path', () => {
  it('reuses the forest, creates a Tapestry tree naming its digest, writes the pointer, imports nothing', async () => {
    const r = rig()
    await importedThenQuit(r)
    const forestCommits = commitCount(r.paths.forest)
    const forestBytes = readFileSync(r.paths.forest)
    rmSync(r.paths.home)
    dropPointer(r)
    const treesBefore = readJson(r.settings.path).trees

    const { service } = launch(r)
    const { problem, restored } = await service.start()

    expect(problem).toBeNull()
    expect(restored).toBe(2)
    // C(i): the forest is reused and not written to.
    expect(commitCount(r.paths.forest)).toBe(forestCommits)
    expect(readFileSync(r.paths.forest).equals(forestBytes)).toBe(true)

    // The new Tapestry tree names this forest by digest.
    service.close()
    const forest = ForestStore.open(r.paths.forest)
    const home = TapestryHome.open(r.paths.home)
    try {
      if (!(forest instanceof ForestStore) || !(home instanceof TapestryHome)) {
        throw new Error('the recovered space did not reopen')
      }
      expect(home.forestRef()).toEqual({ digest: forest.digest(), pathHint: forest.path })
    } finally {
      if (forest instanceof ForestStore) forest.close()
      if (home instanceof TapestryHome) home.close()
    }
    const homeText = readFileSync(r.paths.home, 'utf-8')
    expect(homeText).toContain('actor system tapestry')
    expect(homeText).toContain('create Tapestry tree referencing Forest.tree')

    const after = readJson(r.settings.path)
    expect(after[SETTINGS_POINTER_KEY]).toEqual({ path: r.paths.home })
    expect(after.trees).toEqual(treesBefore)
  })

  it('a foreign file at the forest path is forest-foreign, left byte-for-byte alone, and nothing is created', async () => {
    const r = rig()
    const foreign = makeWorld(join(r.dir, 'space'), 'Forest.tree')
    const bytesBefore = readFileSync(foreign)
    const settingsBefore = readFileSync(r.settings.path)

    const { service } = launch(r)
    const { problem } = await service.start()

    expect(problem).toEqual(expect.objectContaining({ kind: 'forest-foreign', path: r.paths.forest }))
    expect(service.ready).toBe(false)
    expect(readFileSync(foreign).equals(bytesBefore)).toBe(true)
    expect(readFileSync(r.settings.path).equals(settingsBefore)).toBe(true)
    expect(existsSync(r.paths.home)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Case F
// ---------------------------------------------------------------------------

describe('case F: a damaged Tapestry tree', () => {
  it('is home-damaged with the kernel reason and is never repaired', async () => {
    const r = rig()
    await importedThenQuit(r)
    truncateSync(r.paths.home, statSync(r.paths.home).size - 5)
    const bytesBefore = readFileSync(r.paths.home)
    const settingsBefore = readFileSync(r.settings.path)

    const { service, registry } = launch(r)
    const { problem, restored } = await service.start()

    expect(problem?.kind).toBe('home-damaged')
    expect(problem?.path).toBe(r.paths.home)
    expect(problem?.reason?.length ?? 0).toBeGreaterThan(0)
    expect(restored).toBe(0)
    expect(registry.summary()).toEqual([])
    expect(readFileSync(r.paths.home).equals(bytesBefore)).toBe(true)
    expect(readFileSync(r.settings.path).equals(settingsBefore)).toBe(true)
    expect(service.problemNotice()).toContain('Tapestry.tree is damaged')
    expect(service.problemNotice()).toContain(`(${problem?.reason})`)
  })
})

// ---------------------------------------------------------------------------
// Cases I and J
// ---------------------------------------------------------------------------

describe('case I: settings version above 2', () => {
  it('reopens normally, and a later write keeps version 7', async () => {
    const r = rig()
    await importedThenQuit(r)
    const raw = readJson(r.settings.path)
    writeFileSync(r.settings.path, JSON.stringify({ ...raw, version: 7 }, null, 2), 'utf-8')

    const { service } = launch(r)
    const { problem, restored } = await service.start()
    expect(problem).toBeNull()
    expect(restored).toBe(2)

    r.settings.setUserName('someone')
    const after = readJson(r.settings.path)
    expect(after.version).toBe(7)
    expect(after.userName).toBe('someone')
    expect(after.trees).toEqual(raw.trees)
  })
})

describe('case J: a malformed trees entry', () => {
  it('is skipped, counted in the import message, and left in the file', async () => {
    const r = rig()
    const { service } = launch(r)
    await service.start()

    expect(readFileSync(r.paths.forest, 'utf-8')).toContain(
      'import 3 trees and their frames from settings.json; skipped 1 unreadable entries',
    )
    const trees = readJson(r.settings.path).trees as Array<{ path: string }>
    expect(trees.some((t) => t.path === 'relative.tree')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

describe('problemMessage', () => {
  const kinds: SpaceProblemKind[] = [
    'home-missing',
    'home-damaged',
    'home-locked',
    'home-foreign',
    'forest-missing',
    'forest-damaged',
    'forest-locked',
    'forest-foreign',
    'forest-mismatch',
    'setup-failed',
  ]

  it.each(kinds)('%s has approved wording naming the file', (kind) => {
    const path = '/Users/you/Documents/Tapestry/Some.tree'
    const message = problemMessage({ kind, path, reason: 'the reason' })
    if (kind === 'home-locked' || kind === 'forest-locked') {
      // 4.5 names no file: the other window holds the whole space.
      expect(message).toBe(
        'Tapestry is already open in another window, so this window left your space closed. Quit the other window, then relaunch.',
      )
    } else {
      expect(message).toContain(basename(path))
    }
    expect(message.length).toBeGreaterThan(0)
  })
})

describe('SpaceService.noticeFor', () => {
  it('returns the 4.9 sentence for a refused add while no space is open', () => {
    const r = rig()
    const { service, registry } = launch(r)
    const entry = registry.tryOpen(r.alpha, { kind: 'native' })

    let caught: unknown
    try {
      service.addMember(entry, humanActor('kaelen'))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SpaceRefusal)
    expect(service.noticeFor(caught)).toBe(SPACE_NOT_OPEN)
  })

  it("returns the 4.10 sentence for adding the forest, and null for anything else", async () => {
    const r = rig()
    const { service, registry } = launch(r)
    await service.start()

    let caught: unknown
    try {
      registry.tryOpen(r.paths.forest, { kind: 'native' })
    } catch (err) {
      caught = err
    }
    expect(service.noticeFor(caught)).toBe(reservedFileRefusal('Forest.tree'))
    expect(service.noticeFor(new Error('something else'))).toBeNull()
    expect(service.noticeFor('not an error')).toBeNull()
  })
})
