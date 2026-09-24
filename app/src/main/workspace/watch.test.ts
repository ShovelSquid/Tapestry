/**
 * Live watching (02.7 D-06): a file changed outside Tapestry is recorded as
 * `plugin workspace.watcher` within moments, Tapestry's own writes never echo,
 * and a reconcile never reverts an in-process write. Real addon, real temp
 * workspaces, real git, and (where it says so) real FSEvents with real timers.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { WorkspaceService, type WorkspaceServiceOptions } from './workspace-service'
import { FILE_PATH, FILE_TEXT } from './shapes'
import type { NodeData } from '../kernel-bridge'
import { agentActor } from '../commands/actor'
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
