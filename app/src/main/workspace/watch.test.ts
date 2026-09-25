/**
 * Live watching (02.7 D-06): a file changed outside Tapestry is recorded as
 * `plugin workspace.watcher` within moments, Tapestry's own writes never echo,
 * and a reconcile never reverts an in-process write. Real addon, real temp
 * workspaces, real git, and (where it says so) real FSEvents with real timers.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { WorkspaceService, type WorkspaceServiceOptions, type WorkspaceStatus } from './workspace-service'
import { groupMessages } from '../mirror/plan'
import type { FolderWatcherHandlers } from '../mirror/watcher'
import { FILE_PATH, FILE_SHA256, FILE_TEXT } from './shapes'
import type { NodeData } from '../kernel-bridge'
import { agentActor, humanActor } from '../commands/actor'
import { WorkspaceFileCommands } from '../commands/file-tools'
import { makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function setup(opts: Partial<WorkspaceServiceOptions> = {}): {
  ws: TempWorkspace
  registry: TreeRegistry
  service: WorkspaceService
} {
  const ws = makeTempWorkspace()
  const registry = new TreeRegistry()
  const service = new WorkspaceService(registry, { treesDir: ws.treesDir, ...opts })
  cleanups.push(() => {
    service.stopAll()
    registry.closeAll()
    ws.cleanup()
  })
  return { ws, registry, service }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function pollUntil(check: () => boolean, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`not reached within ${timeoutMs} ms`)
    await sleep(50)
  }
}

function noteAt(tree: OpenTree, rel: string): NodeData | undefined {
  return tree.bridge.getNodes().find((node) => node.props[FILE_PATH]?.value === rel)
}

function textAt(tree: OpenTree, rel: string): string | undefined {
  const node = noteAt(tree, rel)
  return node ? String(node.props[FILE_TEXT]?.value) : undefined
}

/** The `@commit` blocks of a journal, in order. */
function commitBlocks(tree: OpenTree): string[] {
  return readFileSync(tree.path, 'utf-8').split('@commit ').slice(1)
}

/** Watch, then give FSEvents a moment to start reporting before the test writes. */
async function watch(service: WorkspaceService, tree: OpenTree): Promise<void> {
  service.startWatching(tree.id)
  await sleep(400)
}

describe('live watching (D-06)', () => {
  it('records a file changed outside Tapestry as workspace.watcher within moments', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    await watch(service, tree)

    const text = "export const greeting = 'changed in an editor'\n"
    writeFileSync(join(ws.root, 'src', 'hello.ts'), text)
    await pollUntil(() => textAt(tree, 'src/hello.ts') === text)

    const last = commitBlocks(tree).at(-1)!
    expect(last).toContain('actor plugin workspace.watcher')
    expect(last).toContain('observed change to src/hello.ts')
  })

  it("never re-records Tapestry's own writes", async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    await watch(service, tree)
    const files = new WorkspaceFileCommands(service)

    const result = files.editFile(agentActor('claude'), {
      path: 'src/hello.ts',
      old_string: "'hello'",
      new_string: "'written by the agent'",
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    const seq = tree.bridge.status().lastGoodSeq
    await sleep(3000)

    expect(tree.bridge.status().lastGoodSeq).toBe(seq)
    const last = commitBlocks(tree).at(-1)!
    expect(last).toContain('actor plugin agent.claude')
    expect(last).toContain('edit src/hello.ts')
  })

  it('never commits a plan read before an in-process write landed (seq guard)', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const files = new WorkspaceFileCommands(service)

    // Started, not awaited: the agent's edit runs before the reconcile settles.
    const reconcile = service.reconcileNow(tree.id, 'all')
    const edit = files.editFile(agentActor('claude'), {
      path: 'src/nested/deep.txt',
      old_string: 'deep text',
      new_string: 'agent text',
    })
    expect(edit.ok, JSON.stringify(edit)).toBe(true)
    await reconcile

    expect(textAt(tree, 'src/nested/deep.txt')).toBe('agent text\n')
    const touching = commitBlocks(tree).filter((block) => block.includes('src/nested/deep.txt'))
    expect(touching.at(-1)).toContain('actor plugin agent.claude')
  })

  it('rebuilds its model when a write lands between reading the folder and planning', async () => {
    let files: WorkspaceFileCommands | null = null
    let landed = false
    const { ws, service } = setup({
      // The reconcile has read deep.txt's old text; now the agent writes it.
      afterModelRead: () => {
        if (landed || !files) return
        landed = true
        const edit = files.editFile(agentActor('claude'), {
          path: 'src/nested/deep.txt',
          old_string: 'deep text',
          new_string: 'agent text',
        })
        expect(edit.ok, JSON.stringify(edit)).toBe(true)
      },
    })
    const tree = await service.addWorkspace(ws.root)
    files = new WorkspaceFileCommands(service)
    // Something else changed outside, so the stale model would have ops to commit.
    writeFileSync(join(ws.root, 'README.md'), '# Changed outside\n')

    await service.reconcileNow(tree.id, 'all')
    expect(landed).toBe(true)
    expect(textAt(tree, 'src/nested/deep.txt')).toBe('agent text\n')
    expect(readFileSync(join(ws.root, 'src', 'nested', 'deep.txt'), 'utf-8')).toBe('agent text\n')
    expect(textAt(tree, 'README.md')).toBe('# Changed outside\n')
    const touching = commitBlocks(tree).filter((block) => block.includes('src/nested/deep.txt'))
    expect(touching.at(-1)).toContain('actor plugin agent.claude')
    const last = commitBlocks(tree).at(-1)!
    expect(last).toContain('actor plugin workspace.watcher')
    expect(last).toContain('observed change to README.md')
  })

  it('records nothing after stopWatching', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    await watch(service, tree)
    service.stopWatching(tree.id)
    expect(service.isWatching(tree.id)).toBe(false)
    const seq = tree.bridge.status().lastGoodSeq

    writeFileSync(join(ws.root, 'README.md'), '# Not watched\n')
    await sleep(2000)
    expect(tree.bridge.status().lastGoodSeq).toBe(seq)
  })
})

describe('moments, deletions and ignores (D-06)', () => {
  it('tags the commits of a moment that needs several', () => {
    const stamp = '2026-09-24T12:00:00Z'
    expect(groupMessages('observed changes: modified a', 3, stamp)).toEqual([
      `observed changes: modified a (group ${stamp}, 1 of 3)`,
      `observed changes: modified a (group ${stamp}, 2 of 3)`,
      `observed changes: modified a (group ${stamp}, 3 of 3)`,
    ])
    expect(groupMessages('observed change to a', 1, stamp)).toEqual(['observed change to a'])
  })

  it('records three files written within 100 ms as one commit listing all three', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    await watch(service, tree)
    const seq = tree.bridge.status().lastGoodSeq

    writeFileSync(join(ws.root, 'README.md'), '# one\n')
    await sleep(40)
    writeFileSync(join(ws.root, 'src', 'hello.ts'), 'two\n')
    await sleep(40)
    writeFileSync(join(ws.root, 'src', 'nested', 'deep.txt'), 'three\n')
    await pollUntil(() => textAt(tree, 'src/nested/deep.txt') === 'three\n')
    await sleep(1500)

    expect(tree.bridge.status().lastGoodSeq).toBe(seq + 1)
    const last = commitBlocks(tree).at(-1)!
    expect(last).toContain('actor plugin workspace.watcher')
    expect(last).toContain('observed changes: modified README.md, src/hello.ts, src/nested/deep.txt')
    expect(textAt(tree, 'README.md')).toBe('# one\n')
    expect(textAt(tree, 'src/hello.ts')).toBe('two\n')
  })

  it('removes a deleted file and its now-empty folder in one observed commit', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    await watch(service, tree)
    const seq = tree.bridge.status().lastGoodSeq
    expect(noteAt(tree, 'src/nested')).toBeDefined()

    unlinkSync(join(ws.root, 'src', 'nested', 'deep.txt'))
    await pollUntil(() => noteAt(tree, 'src/nested/deep.txt') === undefined)
    await sleep(1000)

    expect(noteAt(tree, 'src/nested')).toBeUndefined()
    expect(tree.bridge.status().lastGoodSeq).toBe(seq + 1)
    const last = commitBlocks(tree).at(-1)!
    expect(last).toContain('actor plugin workspace.watcher')
    expect(last).toContain('observed changes: deleted src/nested/deep.txt, src/nested')
    // The deleted file stays in history.
    expect(readFileSync(tree.path, 'utf-8')).toContain('deep text')
  })

  it('adds an untracked file, and removes it once git ignores it', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    await watch(service, tree)

    writeFileSync(join(ws.root, 'notes.tmp.txt'), 'scratch\n')
    await pollUntil(() => textAt(tree, 'notes.tmp.txt') === 'scratch\n')
    expect(commitBlocks(tree).at(-1)).toContain('observed changes: created notes.tmp.txt')

    appendFileSync(join(ws.root, '.gitignore'), 'notes.tmp.txt\n')
    await pollUntil(() => noteAt(tree, 'notes.tmp.txt') === undefined)
    const last = commitBlocks(tree).at(-1)!
    expect(last).toContain('actor plugin workspace.watcher')
    expect(last).toContain('deleted notes.tmp.txt')
  })
})

/** A watcher the test drives by hand. */
function fakeWatchers(): {
  created: FolderWatcherHandlers[]
  closed: number[]
  createWatcher: WorkspaceServiceOptions['createWatcher']
} {
  const created: FolderWatcherHandlers[] = []
  const closed: number[] = []
  return {
    created,
    closed,
    createWatcher: (_root, handlers) => {
      const index = created.length
      created.push(handlers)
      return { close: () => closed.push(index) }
    },
  }
}

describe('watch status and self-healing (D-06, T-02.7-25, T-02.7-26)', () => {
  it('says it is not watching after an error, then restarts with a full catch-up', async () => {
    const statuses: WorkspaceStatus[] = []
    const fake = fakeWatchers()
    const { ws, service } = setup({
      createWatcher: fake.createWatcher,
      restartDelayMs: 100,
      onStatus: (_treeId, status) => statuses.push(status),
    })
    const tree = await service.addWorkspace(ws.root)
    service.startWatching(tree.id)
    expect(statuses).toEqual([{ kind: 'watching' }])

    fake.created[0].onError(new Error('FSEvents stream stopped'))
    expect(statuses.at(-1)).toEqual({ kind: 'not-watching', reason: 'FSEvents stream stopped' })
    expect(fake.closed).toEqual([0])
    expect(service.isWatching(tree.id)).toBe(false)

    // Changed while nothing was watching: only the catch-up can find it.
    writeFileSync(join(ws.root, 'README.md'), '# while not watching\n')
    await pollUntil(() => textAt(tree, 'README.md') === '# while not watching\n', 3000)

    expect(fake.created.length).toBe(2)
    expect(service.isWatching(tree.id)).toBe(true)
    expect(statuses).toEqual([
      { kind: 'watching' },
      { kind: 'not-watching', reason: 'FSEvents stream stopped' },
      { kind: 'watching' },
    ])
    expect(commitBlocks(tree).at(-1)).toContain('observed change to README.md')
  })

  it('records nothing for a folder that disappeared, says so, and heals when it returns', async () => {
    const statuses: WorkspaceStatus[] = []
    const fake = fakeWatchers()
    const { ws, service } = setup({
      createWatcher: fake.createWatcher,
      restartDelayMs: 100,
      onStatus: (_treeId, status) => statuses.push(status),
    })
    const tree = await service.addWorkspace(ws.root)
    service.startWatching(tree.id)
    const seq = tree.bridge.status().lastGoodSeq
    const count = tree.bridge.getNodes().length
    const moved = join(ws.dir, 'moved away')

    renameSync(ws.root, moved)
    await expect(service.reconcileNow(tree.id, 'all')).rejects.toThrow(/is missing; nothing was recorded/)
    expect(statuses.at(-1)).toEqual({ kind: 'folder-missing' })
    expect(tree.bridge.status().lastGoodSeq).toBe(seq)
    expect(tree.bridge.getNodes().length).toBe(count)

    // Still missing at the next restart attempt: nothing changes, no tight loop.
    await sleep(250)
    expect(tree.bridge.status().lastGoodSeq).toBe(seq)
    expect(fake.created.length).toBe(1)

    renameSync(moved, ws.root)
    await pollUntil(() => statuses.at(-1)?.kind === 'watching', 3000)
    expect(fake.created.length).toBe(2)
    expect(tree.bridge.getNodes().length).toBe(count)
  })

  it('stops restarting once the frame is closed', async () => {
    const fake = fakeWatchers()
    const { ws, service } = setup({ createWatcher: fake.createWatcher, restartDelayMs: 50 })
    const tree = await service.addWorkspace(ws.root)
    service.startWatching(tree.id)
    fake.created[0].onError(new Error('gone'))
    service.stopWatching(tree.id)
    await sleep(200)
    expect(fake.created.length).toBe(1)
    expect(service.isWatching(tree.id)).toBe(false)
  })
})

describe('Retry write (D-05)', () => {
  it('resends the same text against the original base: writes once possible, and the file still wins', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const kaelen = humanActor('kaelen')
    const note = noteAt(tree, 'src/nested/deep.txt')!
    const base = String(note.props[FILE_SHA256].value)
    const folder = join(ws.root, 'src', 'nested')
    cleanups.push(() => chmodSync(folder, 0o755))

    // A read-only folder stops the atomic rename.
    chmodSync(folder, 0o555)
    const failed = service.saveFile(kaelen, tree.id, note.id, 'typed in the window\n', base)
    expect(failed.ok).toBe(false)
    expect(!failed.ok && failed.error).toMatch(/^Could not write src\/nested\/deep.txt -- .*Your edit is kept in history\.$/)
    expect(readFileSync(join(folder, 'deep.txt'), 'utf-8')).toBe('deep text\n')

    // Retry write, after the folder is writable again: the same text, the same base.
    chmodSync(folder, 0o755)
    const retried = service.saveFile(kaelen, tree.id, note.id, 'typed in the window\n', base)
    expect(retried.ok && retried.value.written).toBe(true)
    expect(readFileSync(join(folder, 'deep.txt'), 'utf-8')).toBe('typed in the window\n')
  })

  it('lets a file that changed before the retry win', async () => {
    const { ws, service } = setup()
    const tree = await service.addWorkspace(ws.root)
    const kaelen = humanActor('kaelen')
    const note = noteAt(tree, 'src/nested/deep.txt')!
    const base = String(note.props[FILE_SHA256].value)
    const folder = join(ws.root, 'src', 'nested')
    cleanups.push(() => chmodSync(folder, 0o755))

    chmodSync(folder, 0o555)
    expect(service.saveFile(kaelen, tree.id, note.id, 'typed in the window\n', base).ok).toBe(false)
    chmodSync(folder, 0o755)
    writeFileSync(join(folder, 'deep.txt'), 'changed in an editor\n')

    const retried = service.saveFile(kaelen, tree.id, note.id, 'typed in the window\n', base)
    expect(retried.ok && retried.value.fileWins).toBe(true)
    expect(retried.ok && retried.value.written).toBe(false)
    expect(readFileSync(join(folder, 'deep.txt'), 'utf-8')).toBe('changed in an editor\n')
    expect(textAt(tree, 'src/nested/deep.txt')).toBe('changed in an editor\n')
    // Both attempts at the person's edit stay in history.
    expect(commitBlocks(tree).filter((block) => block.includes('edit src/nested/deep.txt')).length).toBe(2)
  })
})
