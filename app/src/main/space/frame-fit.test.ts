/**
 * The automatic fit against the real addon (2.6 Plan 05 Task 2, D-12, T-2.6-01).
 *
 * When the renderer first measures a frame and finds it crowding a neighbour,
 * it asks main to move it clear. Main records that as the system's move, only
 * when the origin actually changes, at most once per member per session, and
 * never for a frame the person has moved this session. Opening a space where
 * nothing moves adds no history (RESEARCH Pitfall 7).
 *
 * Every path is injected under a temp directory (T-2.6-DATA). Each temp world
 * gets a distinct name, because two worlds created with one name in the same
 * second share an id.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { humanActor } from '../commands/actor'
import { KernelBridge } from '../kernel-bridge'
import { SettingsStore } from '../settings'
import { TreeRegistry } from '../trees/registry'
import type { SpacePaths } from './migrate'
import { SpaceService } from './space-service'

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

/** Create a world with a distinct name and release it again. */
function makeWorld(dir: string, file: string): string {
  const path = join(dir, file)
  const bridge = new KernelBridge()
  bridge.create(path, uniqueWorld(file.replace(/\.tree$/, '')))
  bridge.close()
  return path
}

function commitCount(text: string): number {
  return (text.match(/^@commit /gm) ?? []).length
}

function lastCommit(text: string): string {
  return text.slice(text.lastIndexOf('@commit '))
}

interface Rig {
  worlds: string
  settings: SettingsStore
  paths: SpacePaths
  registry: TreeRegistry
  service: SpaceService
  alpha: string
  beta: string
}

/** Case A with two native members, imported from a temp settings.json. */
async function startedRig(): Promise<Rig> {
  const dir = makeTempDir('frame-fit')
  dirs.push(dir)
  const worlds = join(dir, 'worlds')
  mkdirSync(worlds)
  const alpha = makeWorld(worlds, 'alpha.tree')
  const beta = makeWorld(worlds, 'beta.tree')

  const settingsDir = join(dir, 'userData')
  mkdirSync(settingsDir)
  const settings = new SettingsStore(settingsDir)
  writeFileSync(
    settings.path,
    JSON.stringify({
      version: 1,
      userName: 'kaelen',
      agentsEnabled: true,
      trees: [
        { path: alpha, kind: 'native', frame: { x: 0, y: 0 } },
        { path: beta, kind: 'native', frame: { x: 100, y: 20 } },
      ],
    }),
    'utf-8',
  )

  const spaceDir = join(dir, 'space')
  const paths: SpacePaths = {
    forest: join(spaceDir, 'Forest.tree'),
    home: join(spaceDir, 'Tapestry.tree'),
    lastOpenedFile: join(settingsDir, 'last-opened.json'),
  }
  return { worlds, settings, paths, alpha, beta, ...(await launch(settings, paths)) }
}

async function launch(
  settings: SettingsStore,
  paths: SpacePaths,
): Promise<{ registry: TreeRegistry; service: SpaceService }> {
  const registry = new TreeRegistry()
  registries.push(registry)
  const service = new SpaceService({ registry, settings, paths })
  services.push(service)
  const { problem } = await service.start()
  expect(problem).toBeNull()
  return { registry, service }
}

/** Quit and launch again over the same files. */
async function relaunch(r: Rig): Promise<Rig> {
  r.service.close()
  r.registry.closeAll()
  return { ...r, ...(await launch(r.settings, r.paths)) }
}

function forestText(r: Rig): string {
  return readFileSync(r.paths.forest, 'utf-8')
}

function idOf(r: Rig, path: string): string {
  const entry = r.service.list().find((t) => t.path === resolve(path))
  if (!entry) throw new Error(`not listed: ${path}`)
  return entry.id
}

function frameOf(r: Rig, path: string): { x: number; y: number } | undefined {
  return r.service.list().find((t) => t.path === resolve(path))?.frame
}

describe('SpaceService.fitFrame', () => {
  it('writes nothing when the fit lands on the stored origin', async () => {
    const r = await startedRig()
    const before = forestText(r)

    expect(r.service.fitFrame(idOf(r, r.beta), 100, 20)).toEqual({ committed: false })
    expect(forestText(r)).toBe(before)
  })

  it('records a real move as one commit signed by the system, with real origins', async () => {
    const r = await startedRig()
    const before = commitCount(forestText(r))

    expect(r.service.fitFrame(idOf(r, r.beta), 544, 0)).toEqual({ committed: true })

    const text = forestText(r)
    expect(commitCount(text)).toBe(before + 1)
    expect(lastCommit(text)).toContain('actor system tapestry')
    expect(lastCommit(text)).toContain('message "fit frame \\"beta\\" beside its neighbours"')
    expect(frameOf(r, r.beta)).toEqual({ x: 544, y: 0 })

    // Whole numbers are still typed real (RESEARCH Pitfall 3).
    r.service.close()
    r.registry.closeAll()
    const reader = new KernelBridge()
    try {
      reader.open(r.paths.forest)
      for (const edge of reader.getEdges()) {
        expect(edge.props['origin.x'].type).toBe('real')
        expect(edge.props['origin.y'].type).toBe('real')
      }
    } finally {
      reader.close()
    }
  })

  it('fits a member at most once per session', async () => {
    const r = await startedRig()
    r.service.fitFrame(idOf(r, r.beta), 544, 0)
    const before = forestText(r)

    expect(r.service.fitFrame(idOf(r, r.beta), 1000, 0)).toEqual({ committed: false })
    expect(forestText(r)).toBe(before)
    expect(frameOf(r, r.beta)).toEqual({ x: 544, y: 0 })
  })

  it('spends the one fit even when nothing moved', async () => {
    const r = await startedRig()
    r.service.fitFrame(idOf(r, r.beta), 100, 20)
    const before = forestText(r)

    expect(r.service.fitFrame(idOf(r, r.beta), 544, 0)).toEqual({ committed: false })
    expect(forestText(r)).toBe(before)
  })

  it('never moves a frame the person moved this session', async () => {
    const r = await startedRig()
    r.service.moveFrames([{ treeId: idOf(r, r.beta), x: 300, y: 40 }], KAELEN)
    const before = forestText(r)

    expect(r.service.fitFrame(idOf(r, r.beta), 544, 0)).toEqual({ committed: false })
    expect(forestText(r)).toBe(before)
    expect(frameOf(r, r.beta)).toEqual({ x: 300, y: 40 })
  })

  it('also leaves alone a frame the person only pushed aside', async () => {
    const r = await startedRig()
    r.service.moveFrames(
      [
        { treeId: idOf(r, r.alpha), x: 50, y: 0 },
        { treeId: idOf(r, r.beta), x: 600, y: 20 },
      ],
      KAELEN,
    )
    const before = forestText(r)

    expect(r.service.fitFrame(idOf(r, r.beta), 544, 0)).toEqual({ committed: false })
    expect(forestText(r)).toBe(before)
  })

  it('is eligible again after a relaunch, and a fit to the stored value writes nothing', async () => {
    const first = await startedRig()
    first.service.fitFrame(idOf(first, first.beta), 544, 0)
    first.service.moveFrames([{ treeId: idOf(first, first.alpha), x: -700, y: 0 }], KAELEN)

    const r = await relaunch(first)
    const before = forestText(r)

    // The renderer's correction is deterministic, so it asks for the same spot.
    expect(r.service.fitFrame(idOf(r, r.beta), 544, 0)).toEqual({ committed: false })
    expect(forestText(r)).toBe(before)

    // The frame the person moved last session can be fitted in this one.
    expect(r.service.fitFrame(idOf(r, r.alpha), -1200, 0)).toEqual({ committed: true })
    expect(commitCount(forestText(r))).toBe(commitCount(before) + 1)
  })

  it('gives a newly added member one fit', async () => {
    const r = await startedRig()
    const gamma = r.registry.create(join(r.worlds, 'gamma.tree'), uniqueWorld('gamma'), {
      kind: 'native',
    })
    r.service.addMember(gamma, KAELEN)
    const before = commitCount(forestText(r))

    expect(r.service.fitFrame(gamma.id, 2000, 500)).toEqual({ committed: true })
    expect(lastCommit(forestText(r))).toContain('actor system tapestry')
    expect(r.service.fitFrame(gamma.id, 3000, 500)).toEqual({ committed: false })
    expect(commitCount(forestText(r))).toBe(before + 1)
  })

  it('refuses a malformed call or an unknown tree and writes nothing', async () => {
    const r = await startedRig()
    const beta = idOf(r, r.beta)
    const before = forestText(r)

    const bad: Array<[unknown, unknown, unknown]> = [
      [7, 1, 1],
      [null, 1, 1],
      [beta, Number.NaN, 1],
      [beta, 1, Number.POSITIVE_INFINITY],
      [beta, '1', 1],
      [beta, 1, undefined],
      ['sha256:0000', 1, 1],
    ]
    for (const [treeId, x, y] of bad) {
      expect(() => r.service.fitFrame(treeId, x, y)).toThrow()
    }
    expect(forestText(r)).toBe(before)
    // A refused call does not spend the member's fit.
    expect(r.service.fitFrame(beta, 544, 0)).toEqual({ committed: true })
  })

  it('leaves the frame-undo stacks alone', async () => {
    const r = await startedRig()
    r.service.moveFrames([{ treeId: idOf(r, r.alpha), x: -700, y: 0 }], KAELEN)
    r.service.fitFrame(idOf(r, r.beta), 544, 0)

    expect(r.service.undoFrames(KAELEN)).toEqual({ committed: true, undoable: 0, redoable: 1 })
    expect(frameOf(r, r.alpha)).toEqual({ x: 0, y: 0 })
    expect(frameOf(r, r.beta)).toEqual({ x: 544, y: 0 })
  })
})
