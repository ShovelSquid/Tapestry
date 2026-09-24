/**
 * Scale (02.7-06): a repo-sized workspace imports in one catch-up, an idle
 * reconcile reads nothing (the stat cache), a hinted reconcile reads only the
 * hinted file, and the cost of reopening a busy workspace tree is measured.
 *
 * Timings are logged, not gated (except a generous import ceiling): they are
 * copied into the plan SUMMARY so the reopen risk (spike finding 1:
 * `Kernel::fromJournal` copies the world per commit) stays visible.
 *
 * Everything is generated under makeTempDir; no real folder is opened.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { WorkspaceService } from './workspace-service'
import {
  FILE_PATH,
  FILE_TEXT,
  WORKSPACE_FILE_TYPE,
  WORKSPACE_FOLDER_TYPE,
  WORKSPACE_TEXT_TYPE,
} from './shapes'
import { agentActor } from '../commands/actor'
import { WorkspaceFileCommands } from '../commands/file-tools'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { assertNotRealData } from '../../../test/helpers/real-data-guard'
import { isolateGit } from '../../../test/helpers/temp-workspace'

const TEXT_FILES = 800
const BINARY_FILES = 20
const LEAF_FOLDERS = 60
/** Leaf folders sit in ten parents: area0 ... area9. */
const PARENT_FOLDERS = 10
const EDITS = 200

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function folderOf(i: number): string {
  const leaf = i % LEAF_FOLDERS
  return `area${leaf % PARENT_FOLDERS}/f${String(leaf).padStart(2, '0')}`
}

/** 1-4 KB of readable, deterministic text. */
function textFor(i: number): string {
  const target = 1024 + ((i * 397) % 3072)
  const lines: string[] = [`// file ${i}`]
  let size = lines[0].length + 1
  let n = 0
  while (size < target) {
    const line = `export const value${n} = ${(i * 31 + n * 7) % 1000} // line ${n} of file ${i}`
    lines.push(line)
    size += line.length + 1
    n += 1
  }
  return `${lines.join('\n')}\n`
}

function makeBigWorkspace(): { dir: string; root: string; treesDir: string } {
  const dir = makeTempDir('scale')
  const root = join(dir, 'Big Space')
  const treesDir = join(dir, 'app-data', 'workspaces')
  assertNotRealData(root)
  assertNotRealData(treesDir)

  for (let i = 0; i < TEXT_FILES; i += 1) {
    const folder = join(root, ...folderOf(i).split('/'))
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, `file${i}.ts`), textFor(i))
  }
  for (let i = 0; i < BINARY_FILES; i += 1) {
    const bytes = Buffer.alloc(512 + i, 0)
    bytes.write('BLOB', 0)
    writeFileSync(join(root, ...folderOf(i * 3).split('/'), `blob${i}.bin`), bytes)
  }
  writeFileSync(join(root, 'area0', 'f00', 'counter.txt'), 'count 0\n')

  isolateGit()
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  }
  git('init', '-q')
  git('add', '-A')
  git(
    '-c',
    'user.name=tapestry-test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'fixture',
  )
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, root, treesDir }
}

function countByType(tree: OpenTree): Record<string, number> {
  const out: Record<string, number> = {}
  for (const node of tree.bridge.getNodes()) out[node.type] = (out[node.type] ?? 0) + 1
  return out
}

describe('an 800-file workspace', () => {
  it('imports in one catch-up, reconciles idle for free, and reopens after 200 edits', async () => {
    const { root, treesDir } = makeBigWorkspace()
    const registry = new TreeRegistry()
    cleanups.push(() => registry.closeAll())
    const service = new WorkspaceService(registry, { treesDir })

    // --- Import -------------------------------------------------------------
    let started = performance.now()
    const tree = await service.addWorkspace(root)
    const importMs = performance.now() - started
    console.info(`[scale] import ${Math.round(importMs)} ms`)
    expect(importMs).toBeLessThan(60000)

    const counts = countByType(tree)
    // counter.txt is the 801st text file.
    expect(counts[WORKSPACE_TEXT_TYPE]).toBe(TEXT_FILES + 1)
    expect(counts[WORKSPACE_FILE_TYPE]).toBe(BINARY_FILES)
    expect(counts[WORKSPACE_FOLDER_TYPE]).toBe(LEAF_FOLDERS + PARENT_FOLDERS)

    // --- An idle reconcile reads nothing and commits nothing ------------------
    const seq = tree.bridge.status().lastGoodSeq
    started = performance.now()
    const idle = await service.reconcileNow(tree.id, 'all')
    const idleMs = performance.now() - started
    console.info(`[scale] idle reconcile ${Math.round(idleMs)} ms`)
    expect(idle).toEqual({
      listed: TEXT_FILES + BINARY_FILES + 1,
      read: 0,
      reused: TEXT_FILES + BINARY_FILES + 1,
      commits: 0,
    })
    expect(tree.bridge.status().lastGoodSeq).toBe(seq)

    // --- One touched file is the only one read --------------------------------
    const touched = `${folderOf(5)}/file5.ts`
    writeFileSync(join(root, ...touched.split('/')), '// touched outside\n')
    const hinted = await service.reconcileNow(tree.id, new Set([touched, folderOf(5)]))
    expect(hinted.read).toBe(1)
    expect(hinted.commits).toBe(1)

    // --- A baseline reopen, with only the import's few commits ------------------
    const path = tree.path
    const openOpts = { kind: 'workspace' as const, workspaceRoot: root, name: 'Big Space' }
    const baseCommits = tree.bridge.status().lastGoodSeq
    registry.close(tree.id)
    started = performance.now()
    const baseline = registry.tryOpen(path, openOpts)
    const baselineMs = performance.now() - started
    console.info(`[scale] reopen after import ${Math.round(baselineMs)} ms (${baseCommits} commits)`)
    expect('bridge' in baseline && baseline.id).toBe(tree.id)

    // --- 200 agent edits, then the reopen is timed -----------------------------
    const files = new WorkspaceFileCommands(service)
    const counter = 'area0/f00/counter.txt'
    started = performance.now()
    for (let i = 0; i < EDITS; i += 1) {
      const result = files.editFile(agentActor('claude'), {
        path: counter,
        old_string: `count ${i}\n`,
        new_string: `count ${i + 1}\n`,
      })
      expect(result.ok, JSON.stringify(result)).toBe(true)
    }
    const editsMs = performance.now() - started
    console.info(`[scale] ${EDITS} agent edits ${Math.round(editsMs)} ms (${(editsMs / EDITS).toFixed(1)} ms each)`)
    const commitsBefore = (baseline as OpenTree).bridge.status().lastGoodSeq
    expect(commitsBefore).toBe(baseCommits + EDITS)
    registry.close(tree.id)

    started = performance.now()
    const reopened = registry.tryOpen(path, openOpts)
    const reopenMs = performance.now() - started
    console.info(`[scale] reopen after ${EDITS} edits ${Math.round(reopenMs)} ms (${commitsBefore} commits)`)

    expect('bridge' in reopened).toBe(true)
    const open = reopened as OpenTree
    expect(open.bridge.status().lastGoodSeq).toBe(commitsBefore)
    const note = open.bridge.getNodes().find((node) => node.props[FILE_PATH]?.value === counter)
    expect(String(note?.props[FILE_TEXT]?.value)).toBe(`count ${EDITS}\n`)
  }, 120000)
})
