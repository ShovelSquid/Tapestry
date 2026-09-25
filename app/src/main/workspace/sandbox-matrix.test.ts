/**
 * The D-08 refusal matrix, end to end (02.7 SC3): every escape, through the
 * real dispatch, for every file tool it applies to, is refused with its
 * reason, and the fingerprint of the whole temp directory, the journal and
 * the tree's head is unchanged.
 *
 * Temp workspaces only (makeTempWorkspace); never a real worktree.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { NoteCommands } from '../commands/notes'
import { ConnectionCommands } from '../commands/connections'
import { SpatialCommands } from '../commands/spatial'
import { runAgentTool, type AgentCommands } from '../commands/agent-tools'
import { WorkspaceFileCommands } from '../commands/file-tools'
import { agentActor } from '../commands/actor'
import { WorkspaceService } from './workspace-service'
import { FILE_PATH } from './shapes'
import { makeTempWorkspace, type TempWorkspace } from '../../../test/helpers/temp-workspace'

const CLAUDE = agentActor('claude')

type Tool = 'read_file' | 'write_file' | 'edit_file' | 'list_files'
const FILE_TOOLS: Tool[] = ['read_file', 'write_file', 'edit_file']
const ALL_TOOLS: Tool[] = [...FILE_TOOLS, 'list_files']

let ws: TempWorkspace
let other: TempWorkspace
let registry: TreeRegistry
let service: WorkspaceService
let commands: AgentCommands
let tree: OpenTree
let nativeTree: OpenTree
let closedId: string

beforeAll(async () => {
  ws = makeTempWorkspace()
  other = makeTempWorkspace()
  // A sibling whose name starts with the root's name (T-02.7-14).
  mkdirSync(join(ws.dir, 'Work Space2'))
  writeFileSync(join(ws.dir, 'Work Space2', 'x.txt'), 'sibling\n')

  registry = new TreeRegistry()
  service = new WorkspaceService(registry, { treesDir: ws.treesDir })
  tree = await service.addWorkspace(ws.root)
  nativeTree = registry.create(join(ws.dir, 'native.tree'), 'native')

  // A workspace that was added and then closed.
  const closing = await service.addWorkspace(other.root)
  closedId = closing.id
  registry.close(closedId)

  commands = {
    notes: new NoteCommands(registry),
    connections: new ConnectionCommands(registry),
    spatial: new SpatialCommands(registry),
    files: new WorkspaceFileCommands(service),
  }
}, 30000)

afterAll(() => {
  registry?.closeAll()
  ws?.cleanup()
  other?.cleanup()
})

/**
 * sha256 of every regular file under `dir`, walked with lstat (links are
 * recorded by target, never followed), plus the journal's byte size, the
 * node count and the head seq.
 */
function fingerprint(dir: string, t: OpenTree | null): string {
  const lines: string[] = []
  const visit = (abs: string, rel: string): void => {
    for (const name of readdirSync(abs).sort()) {
      const childAbs = join(abs, name)
      const childRel = rel ? `${rel}/${name}` : name
      const stats = lstatSync(childAbs)
      if (stats.isSymbolicLink()) lines.push(`${childRel}->${readlinkSync(childAbs)}`)
      else if (stats.isDirectory()) visit(childAbs, childRel)
      else if (stats.isFile()) {
        lines.push(`${childRel}:${createHash('sha256').update(readFileSync(childAbs)).digest('hex')}`)
      }
    }
  }
  visit(dir, '')
  if (t) {
    lines.push(`journal ${statSync(t.path).size}`)
    lines.push(`nodes ${t.bridge.getNodes().length}`)
    lines.push(`head ${t.bridge.status().lastGoodSeq}`)
  }
  return lines.join('\n')
}

function argsFor(tool: Tool, target: { workspace?: string; path: string }): Record<string, unknown> {
  const base: Record<string, unknown> = { path: target.path }
  if (target.workspace !== undefined) base.workspace = target.workspace
  if (tool === 'write_file') return { ...base, text: 'x' }
  if (tool === 'edit_file') return { ...base, old_string: 'a', new_string: 'b' }
  return base
}

interface Escape {
  name: string
  target: () => { workspace?: string; path: string }
  fragment: string | RegExp
  tools: Tool[]
}

const OUTSIDE = /outside (the|every open) workspace/

const ESCAPES: Escape[] = [
  { name: "'..'", target: () => ({ path: '../outside/secret.txt' }), fragment: "uses '..'", tools: ALL_TOOLS },
  {
    name: "'..' after a folder",
    target: () => ({ path: 'src/../../outside/secret.txt' }),
    fragment: "uses '..'",
    tools: ALL_TOOLS,
  },
  { name: 'absolute outside', target: () => ({ path: join(ws.outside, 'secret.txt') }), fragment: OUTSIDE, tools: ALL_TOOLS },
  {
    name: 'absolute outside, realpath spelling',
    target: () => ({ path: join(realDir(), 'outside', 'secret.txt') }),
    fragment: OUTSIDE,
    tools: ALL_TOOLS,
  },
  {
    name: 'sibling sharing the root name as a prefix',
    target: () => ({ path: join(ws.dir, 'Work Space2', 'x.txt') }),
    fragment: OUTSIDE,
    tools: ALL_TOOLS,
  },
  { name: 'directory symlink', target: () => ({ path: 'link-out/secret.txt' }), fragment: 'symbolic link', tools: ALL_TOOLS },
  { name: 'file symlink', target: () => ({ path: 'src/link.txt' }), fragment: 'symbolic link', tools: ALL_TOOLS },
  { name: '.git', target: () => ({ path: '.git/config' }), fragment: 'inside .git', tools: ALL_TOOLS },
  { name: '.GIT', target: () => ({ path: '.GIT/HEAD' }), fragment: 'inside .git', tools: ALL_TOOLS },
  { name: 'nested .git', target: () => ({ path: 'src/.git/x' }), fragment: 'inside .git', tools: ALL_TOOLS },
  { name: 'ignored node_modules', target: () => ({ path: 'node_modules/pkg/index.js' }), fragment: 'ignored by git', tools: FILE_TOOLS },
  { name: 'ignored .env', target: () => ({ path: '.env' }), fragment: 'ignored by git', tools: FILE_TOOLS },
  { name: 'ignored out/', target: () => ({ path: 'out/build.js' }), fragment: 'ignored by git', tools: FILE_TOOLS },
  // The schemas require a non-empty path for file tools, so '' is refused by
  // validation before the sandbox; list_files takes '' as the root.
  { name: 'empty path', target: () => ({ path: '' }), fragment: 'path', tools: FILE_TOOLS },
  { name: 'the root itself', target: () => ({ path: '.' }), fragment: 'path must name a file', tools: FILE_TOOLS },
  { name: 'backslash', target: () => ({ path: 'src\\hello.ts' }), fragment: 'path must name a file', tools: ALL_TOOLS },
  { name: 'NUL', target: () => ({ path: 'src/hello.ts\0.txt' }), fragment: 'path must name a file', tools: ALL_TOOLS },
  { name: 'a folder', target: () => ({ path: 'src' }), fragment: 'is a folder', tools: FILE_TOOLS },
  {
    name: 'a Tapestry temp name',
    target: () => ({ path: '.hello.ts.tapestry-tmp-1-abcd' }),
    fragment: 'Tapestry temporary file',
    tools: ALL_TOOLS,
  },
  {
    name: 'unknown workspace',
    target: () => ({ workspace: 'no-such', path: 'src/hello.ts' }),
    fragment: 'is not an open workspace',
    tools: ALL_TOOLS,
  },
  {
    name: 'a native tree named as workspace',
    target: () => ({ workspace: nativeTree.id, path: 'src/hello.ts' }),
    fragment: 'is not an open workspace',
    tools: ALL_TOOLS,
  },
  {
    name: 'a native tree named by name',
    target: () => ({ workspace: nativeTree.name, path: 'src/hello.ts' }),
    fragment: 'is not an open workspace',
    tools: ALL_TOOLS,
  },
  {
    name: 'a closed workspace',
    target: () => ({ workspace: closedId, path: 'src/hello.ts' }),
    fragment: 'is not an open workspace',
    tools: ALL_TOOLS,
  },
]

/** The temp dir with links resolved (/var/folders/... is /private/var/folders/... on macOS). */
function realDir(): string {
  return realpathSync(ws.dir)
}

describe('the D-08 refusal matrix', () => {
  for (const escape of ESCAPES) {
    for (const tool of escape.tools) {
      it(`${tool}: ${escape.name} is refused and nothing changes`, () => {
        const before = fingerprint(ws.dir, tree)
        const result = runAgentTool(commands, CLAUDE, tool, argsFor(tool, escape.target()))
        expect(result.ok, JSON.stringify(result)).toBe(false)
        const error = (result as { error: string }).error
        if (typeof escape.fragment === 'string') expect(error).toContain(escape.fragment)
        else expect(error).toMatch(escape.fragment)
        expect(fingerprint(ws.dir, tree)).toBe(before)
      })
    }
  }

  it('with no workspace open, every tool says so and nothing changes', () => {
    const fresh = new TreeRegistry()
    try {
      const freshService = new WorkspaceService(fresh, { treesDir: join(ws.dir, 'none') })
      const freshCommands: AgentCommands = {
        notes: new NoteCommands(fresh),
        connections: new ConnectionCommands(fresh),
        spatial: new SpatialCommands(fresh),
        files: new WorkspaceFileCommands(freshService),
      }
      const before = fingerprint(ws.dir, tree)
      for (const tool of ALL_TOOLS) {
        const result = runAgentTool(freshCommands, CLAUDE, tool, argsFor(tool, { path: 'src/hello.ts' }))
        expect(result.ok).toBe(false)
        expect((result as { error: string }).error).toContain('No workspace is open in Tapestry')
      }
      expect(fingerprint(ws.dir, tree)).toBe(before)
    } finally {
      fresh.closeAll()
    }
  })
})

describe('canonical-case paths', () => {
  it('a path spelled in another case edits the existing file and its note', () => {
    const probe = join(ws.dir, 'case-probe')
    writeFileSync(probe, 'probe')
    let insensitive = false
    try {
      lstatSync(join(ws.dir, 'CASE-PROBE'))
      insensitive = true
    } catch {
      insensitive = false
    }
    rmSync(probe)
    if (!insensitive) {
      console.log('[sandbox-matrix] skipped: this volume is case-sensitive')
      return
    }

    const countNotes = (): number =>
      tree.bridge
        .getNodes()
        .filter((node) => String(node.props[FILE_PATH]?.value ?? '').toLowerCase() === 'src/hello.ts').length
    expect(countNotes()).toBe(1)

    const result = runAgentTool(commands, CLAUDE, 'edit_file', {
      path: 'SRC/Hello.ts',
      old_string: "'hello'",
      new_string: "'hello again'",
    })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect((result as { value: { path: string } }).value.path).toBe('src/hello.ts')
    expect(readFileSync(join(ws.root, 'src', 'hello.ts'), 'utf-8')).toContain("'hello again'")
    const journal = readFileSync(tree.path, 'utf-8')
    expect(journal.slice(journal.lastIndexOf('@commit '))).toContain('edit src/hello.ts (1 replacement)')
    expect(countNotes()).toBe(1)
  })
})
