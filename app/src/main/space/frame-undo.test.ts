/**
 * Frame undo and redo against the real addon (2.6 Plan 05 Task 1, D-08, D-09).
 *
 * Undoing a drop is a new forest commit, signed by the person, that writes
 * back the origins read from the forest before the drop. The forest is never
 * rewound, so the next drop still commits. Redo mirrors it. An entry whose
 * frame moved since, or whose stand-in is gone, is skipped, and a step where
 * nothing applies writes nothing.
 *
 * Every path is injected under a temp directory (T-2.6-DATA): the space
 * folder, the settings folder and last-opened.json. Each temp world gets a
 * distinct name, because two worlds created with one name in the same second
 * share an id.
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
import { FRAME_HISTORY_LIMIT, SpaceService } from './space-service'

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

/** The text of the forest's last commit. */
function lastCommit(text: string): string {
  return text.slice(text.lastIndexOf('@commit '))
}

interface Rig {
  paths: SpacePaths
  service: SpaceService
  alpha: string
  beta: string
  gamma: string
}

/**
 * Case A with three native members, as a first launch imports them from
 * settings.json. Nothing outside the temp folder is read or written.
 */
async function startedRig(opts: { frameHistoryLimit?: number } = {}): Promise<Rig> {
  const dir = makeTempDir('frame-undo')
  dirs.push(dir)
  const worlds = join(dir, 'worlds')
  mkdirSync(worlds)
  const alpha = makeWorld(worlds, 'alpha.tree')
  const beta = makeWorld(worlds, 'beta.tree')
  const gamma = makeWorld(worlds, 'gamma.tree')

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
        { path: alpha, kind: 'native', frame: { x: -245.01090741236075, y: -65.5 } },
        { path: beta, kind: 'native', frame: { x: 800, y: 12.5 } },
        { path: gamma, kind: 'native', frame: { x: 1600, y: 0 } },
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
  const registry = new TreeRegistry()
  registries.push(registry)
  const service = new SpaceService({ registry, settings, paths, ...opts })
  services.push(service)
  const { problem } = await service.start()
  expect(problem).toBeNull()
  return { paths, service, alpha, beta, gamma }
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

function framesOf(r: Rig): Record<string, { x: number; y: number } | undefined> {
  return { alpha: frameOf(r, r.alpha), beta: frameOf(r, r.beta), gamma: frameOf(r, r.gamma) }
}

describe('SpaceService.undoFrames', () => {
  it('puts a drop back with one new commit signed by the person, and never rewinds the forest', async () => {
    const r = await startedRig()
    const stored = frameOf(r, r.alpha)
    r.service.moveFrames([{ treeId: idOf(r, r.alpha), x: 40, y: 12.5 }], KAELEN)
    const afterDrop = commitCount(forestText(r))

    const result = r.service.undoFrames(KAELEN)

    expect(result).toEqual({ committed: true, undoable: 0, redoable: 1 })
    const text = forestText(r)
    expect(commitCount(text)).toBe(afterDrop + 1)
    expect(lastCommit(text)).toContain('actor human user.kaelen')
    expect(lastCommit(text)).toContain('message "undo move frame \\"alpha\\""')
    expect(frameOf(r, r.alpha)).toEqual(stored)

    // A rewound forest would refuse this drop (D-09).
    expect(r.service.moveFrames([{ treeId: idOf(r, r.alpha), x: 7, y: 8 }], KAELEN)).toEqual({
      committed: true,
    })
    expect(commitCount(forestText(r))).toBe(afterDrop + 2)
    expect(frameOf(r, r.alpha)).toEqual({ x: 7, y: 8 })
  })

  it('restores the dragged frame and every frame it pushed aside in one commit', async () => {
    const r = await startedRig()
    const before = framesOf(r)
    r.service.moveFrames(
      [
        { treeId: idOf(r, r.alpha), x: 900, y: 10 },
        { treeId: idOf(r, r.beta), x: 1500, y: 12.5 },
        { treeId: idOf(r, r.gamma), x: 2300, y: 0 },
      ],
      KAELEN,
    )
    const afterDrop = commitCount(forestText(r))

    expect(r.service.undoFrames(KAELEN).committed).toBe(true)

    expect(commitCount(forestText(r))).toBe(afterDrop + 1)
    expect(framesOf(r)).toEqual(before)
  })

  it('walks back two drops in reverse order', async () => {
    const r = await startedRig()
    const start = framesOf(r)
    r.service.moveFrames([{ treeId: idOf(r, r.alpha), x: 10, y: 10 }], KAELEN)
    const afterFirst = framesOf(r)
    r.service.moveFrames([{ treeId: idOf(r, r.alpha), x: 20, y: 20 }], KAELEN)

    expect(r.service.undoFrames(KAELEN)).toEqual({ committed: true, undoable: 1, redoable: 1 })
    expect(framesOf(r)).toEqual(afterFirst)
    expect(r.service.undoFrames(KAELEN)).toEqual({ committed: true, undoable: 0, redoable: 2 })
    expect(framesOf(r)).toEqual(start)
  })

  it('redo writes the moved origins again with the redo message', async () => {
    const r = await startedRig()
    r.service.moveFrames(
      [
        { treeId: idOf(r, r.alpha), x: 900, y: 10 },
        { treeId: idOf(r, r.beta), x: 1500, y: 12.5 },
      ],
      KAELEN,
    )
    const moved = framesOf(r)
    r.service.undoFrames(KAELEN)
    const afterUndo = commitCount(forestText(r))

    expect(r.service.redoFrames(KAELEN)).toEqual({ committed: true, undoable: 1, redoable: 0 })

    const text = forestText(r)
    expect(commitCount(text)).toBe(afterUndo + 1)
    expect(lastCommit(text)).toContain('actor human user.kaelen')
    expect(lastCommit(text)).toContain('message "redo move frame \\"alpha\\""')
    expect(framesOf(r)).toEqual(moved)
  })

  it('a new drop after an undo leaves nothing to redo', async () => {
    const r = await startedRig()
    r.service.moveFrames([{ treeId: idOf(r, r.alpha), x: 10, y: 10 }], KAELEN)
    r.service.undoFrames(KAELEN)
    r.service.moveFrames([{ treeId: idOf(r, r.beta), x: 30, y: 30 }], KAELEN)
    const before = forestText(r)

    expect(r.service.redoFrames(KAELEN)).toEqual({ committed: false, undoable: 1, redoable: 0 })
    expect(forestText(r)).toBe(before)
  })

  it('writes nothing when the moved tree has left the forest', async () => {
    const r = await startedRig()
    r.service.moveFrames([{ treeId: idOf(r, r.alpha), x: 10, y: 10 }], KAELEN)
    r.service.removeMember(idOf(r, r.alpha), KAELEN)
    const before = forestText(r)

    expect(r.service.undoFrames(KAELEN)).toEqual({ committed: false, undoable: 0, redoable: 0 })
    expect(forestText(r)).toBe(before)
  })

  it('skips an entry whose stand-in is gone and restores the rest', async () => {
    const r = await startedRig()
    const start = framesOf(r)
    r.service.moveFrames(
      [
        { treeId: idOf(r, r.alpha), x: 900, y: 10 },
        { treeId: idOf(r, r.beta), x: 1500, y: 12.5 },
      ],
      KAELEN,
    )
    r.service.removeMember(idOf(r, r.beta), KAELEN)
    const before = commitCount(forestText(r))

    expect(r.service.undoFrames(KAELEN).committed).toBe(true)
    expect(commitCount(forestText(r))).toBe(before + 1)
    expect(frameOf(r, r.alpha)).toEqual(start.alpha)
  })

  it('writes nothing with empty stacks', async () => {
    const r = await startedRig()
    const before = forestText(r)

    expect(r.service.undoFrames(KAELEN)).toEqual({ committed: false, undoable: 0, redoable: 0 })
    expect(r.service.redoFrames(KAELEN)).toEqual({ committed: false, undoable: 0, redoable: 0 })
    expect(forestText(r)).toBe(before)
  })

  it('reports the stack sizes after each call', async () => {
    const r = await startedRig()
    for (const x of [1, 2, 3]) {
      r.service.moveFrames([{ treeId: idOf(r, r.alpha), x, y: 0 }], KAELEN)
    }
    expect(r.service.undoFrames(KAELEN)).toMatchObject({ undoable: 2, redoable: 1 })
    expect(r.service.undoFrames(KAELEN)).toMatchObject({ undoable: 1, redoable: 2 })
    expect(r.service.redoFrames(KAELEN)).toMatchObject({ undoable: 2, redoable: 1 })
    expect(frameOf(r, r.alpha)).toEqual({ x: 2, y: 0 })
  })

  it('remembers at most frameHistoryLimit drops, forgetting the oldest', async () => {
    expect(FRAME_HISTORY_LIMIT).toBe(100)
    const r = await startedRig({ frameHistoryLimit: 3 })
    for (const x of [1, 2, 3, 4]) {
      r.service.moveFrames([{ treeId: idOf(r, r.alpha), x, y: 0 }], KAELEN)
    }

    for (let i = 0; i < 3; i += 1) expect(r.service.undoFrames(KAELEN).committed).toBe(true)
    // The first drop (to x = 1) was forgotten, so alpha stays where it put it.
    expect(frameOf(r, r.alpha)).toEqual({ x: 1, y: 0 })
    const before = forestText(r)
    expect(r.service.undoFrames(KAELEN)).toEqual({ committed: false, undoable: 0, redoable: 3 })
    expect(forestText(r)).toBe(before)
  })
})
