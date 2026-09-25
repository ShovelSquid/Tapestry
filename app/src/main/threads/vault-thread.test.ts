/**
 * Vault threads (D-25): a thread whose `.md` file stays an ordinary vault
 * note, and an edit made outside Tapestry arrives on the line honestly.
 *
 * Every test here runs against a **temp copy of the synthetic fixture
 * vault** (`makeTempVault`) or a bare temp `.tree` (`createTempTree`) — never
 * a real vault or a real world file, matching every other vault test in this
 * codebase (`obsidian/mirror.test.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Fragment, Slice } from 'prosemirror-model'
import { ReplaceStep } from 'prosemirror-transform'
import { tapestrySchema } from '../../renderer/editor/schema'
import { humanActor, OBSIDIAN_BRIDGE_ACTOR } from '../commands/actor'
import type { NodeData, OpObject } from '../kernel-bridge'
import { VaultService } from '../obsidian/vault-service'
import { MD_PATH, MD_SHA256, MD_TEXT, VAULT_NOTE_TYPE } from '../obsidian/shapes'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { parseBlock } from '../../shared/threads/grammar'
import { threadInitialProperties } from '../../shared/threads/settings'
import { createTempTree, type TempTree } from '../../../test/helpers/temp-tree'
import { makeTempVault, type TempVault } from '../../../test/helpers/temp-vault'
import { ThreadService } from './thread-service'
import { diffFlatText, isVaultThread, observeVaultEdit, writeVaultThreadFile } from './vault-thread'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function propString(node: NodeData, key: string): string | null {
  const prop = node.props[key]
  return prop && typeof prop.value === 'string' ? prop.value : null
}

/** The full D-25 thread property set as `setProperty` ops, for turning an
 * already-mirrored vault note into a vault thread. */
function threadPropOps(nodeId: string): OpObject[] {
  const props = threadInitialProperties(0, 0)
  return Object.entries(props).map(([key, prop]) => ({
    op: 'setProperty',
    target: nodeId,
    key,
    type: prop.type,
    value: prop.value,
  }))
}

/** A single-run text insertion, as the renderer's collab plugin would
 * serialize it (`thread-service.test.ts`'s own `insertCharStepJson`,
 * generalized to a whole run rather than one character). */
function insertTextStepJson(pos: number, text: string): unknown {
  const step = new ReplaceStep(pos, pos, new Slice(Fragment.from(tapestrySchema.text(text)), 0, 0))
  return step.toJSON()
}

interface VaultThreadFixture {
  vault: TempVault
  registry: TreeRegistry
  vaultService: VaultService
  tree: OpenTree
  nodeId: string
  actor: ReturnType<typeof humanActor>
}

/** Copies the synthetic fixture vault, adds one empty `.md` file, mirrors the
 * vault into a tree, and turns that one file into a vault thread — the setup
 * every Task 1/2 test in this file starts from. Starting the file empty
 * sidesteps the (out of scope) question of what happens when an *existing*,
 * already-written vault note is turned into a thread; this plan is about the
 * storage division and the observed-edit path, not that onboarding flow. */
async function setUpVaultThread(fileName = 'Thread.md'): Promise<VaultThreadFixture> {
  const vault = makeTempVault()
  writeFileSync(join(vault.root, fileName), '')

  const registry = new TreeRegistry()
  const vaultService = new VaultService(registry)
  const tree = await vaultService.addVault(vault.root)

  const noteNode = tree.bridge.getNodes().find((n) => propString(n, MD_PATH) === fileName)
  if (!noteNode) throw new Error(`fixture setup failed: no node for ${fileName}`)
  const nodeId = noteNode.id

  const actor = humanActor('kaelen')
  tree.bridge.submitAs(actor, 'Make this note a thread', threadPropOps(nodeId))

  return { vault, registry, vaultService, tree, nodeId, actor }
}

// ---------------------------------------------------------------------------
// isVaultThread
// ---------------------------------------------------------------------------

describe('isVaultThread', () => {
  it('is true only for a vault note that also carries the thread property set', () => {
    expect(
      isVaultThread({
        type: VAULT_NOTE_TYPE,
        props: { 'thread.format': { type: 'int', value: 1 } },
      }),
    ).toBe(true)
  })

  it('is false for a plain vault note with no thread properties', () => {
    expect(isVaultThread({ type: VAULT_NOTE_TYPE, props: {} })).toBe(false)
  })

  it('is false for an ordinary (non-vault) thread node', () => {
    expect(
      isVaultThread({
        type: 'tapestry.threads/thread@1',
        props: { 'thread.format': { type: 'int', value: 1 } },
      }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// diffFlatText — the single-cluster diff underlying observeVaultEdit
// ---------------------------------------------------------------------------

describe('diffFlatText', () => {
  it('returns null for identical text (a no-op rewrite records nothing)', () => {
    expect(diffFlatText('Hello', 'Hello')).toBeNull()
  })

  it('finds the smallest single replace for an append', () => {
    expect(diffFlatText('Hello', 'Hello World')).toEqual({ from: 5, to: 5, insertText: ' World' })
  })

  it('finds the smallest single replace for an edit in the middle', () => {
    expect(diffFlatText('Hello World', 'Hello there World')).toEqual({ from: 6, to: 6, insertText: 'there ' })
  })

  it('finds the smallest single replace for a deletion', () => {
    expect(diffFlatText('Hello World', 'Hello')).toEqual({ from: 5, to: 11, insertText: '' })
  })
})

// ---------------------------------------------------------------------------
// Task 1: Tapestry's own write reaches the vault file
// ---------------------------------------------------------------------------

describe('vault thread: a Tapestry write reaches the .md file', () => {
  let fixture: VaultThreadFixture | null = null

  afterEach(() => {
    fixture?.registry.closeAll()
    fixture?.vault.cleanup()
    fixture = null
  })

  it('writes the document current text to the file byte for byte, leaking nothing else into it', async () => {
    fixture = await setUpVaultThread()
    const { vault, vaultService, tree, nodeId, actor } = fixture

    const threadNode = tree.bridge.getNode(nodeId)!
    expect(isVaultThread(threadNode)).toBe(true)

    const service = new ThreadService()
    service.open(tree.bridge, actor, tree.id, nodeId)
    const pushed = service.push(tree.id, nodeId, actor, 0, [insertTextStepJson(1, 'Hello World')], [1000], [null])
    expect(pushed.confirmed).toBe(true)
    service.close(tree.id, nodeId)

    await writeVaultThreadFile(vaultService, service, tree.bridge, actor, tree.id, nodeId)
    service.close(tree.id, nodeId) // tidy up the handle writeVaultThreadFile's readFlatText reopened

    const filePath = join(vault.root, 'Thread.md')
    const fileText = readFileSync(filePath, 'utf-8')
    expect(fileText).toBe('Hello World')

    // The must_haves' own words: no offset, no deleted letter, no actor id,
    // no Tapestry front-matter block anywhere in the file.
    expect(fileText).not.toMatch(/thread\.log|actor plugin|actor human|"stepType"|\+\d+\.\d{3}/)

    // thread.log and the thread settings/frame keys live in the vault tree.
    expect(tree.bridge.getPropertyValues(nodeId, 'thread.log').length).toBeGreaterThan(0)
    const updated = tree.bridge.getNode(nodeId)!
    expect(propString(updated, MD_TEXT)).toBe('Hello World')
    expect(updated.props[MD_SHA256]).toBeDefined()
    expect(updated.props['thread.timeout']).toBeDefined()
  })

  it('skips the write and commits nothing once the file already says the same thing (no echo)', async () => {
    fixture = await setUpVaultThread()
    const { vault, vaultService, tree, nodeId, actor } = fixture

    const service = new ThreadService()
    service.open(tree.bridge, actor, tree.id, nodeId)
    service.push(tree.id, nodeId, actor, 0, [insertTextStepJson(1, 'Hi')], [1000], [null])
    service.close(tree.id, nodeId)
    await writeVaultThreadFile(vaultService, service, tree.bridge, actor, tree.id, nodeId)

    // Measured on md.sha256's own value history, not the raw commit count:
    // `close()` always writes a fresh body checkpoint commit regardless of
    // whether anything changed (an orthogonal, pre-existing cadence rule),
    // so counting *all* commits here would fail for a reason that has
    // nothing to do with the no-echo guarantee this test actually checks.
    const before = tree.bridge.getPropertyValues(nodeId, MD_SHA256).length

    // Nothing changed on the Tapestry side; asking again must be a no-op --
    // no file write, no md.text/md.sha256 commit.
    await writeVaultThreadFile(vaultService, service, tree.bridge, actor, tree.id, nodeId)
    service.close(tree.id, nodeId)

    const after = tree.bridge.getPropertyValues(nodeId, MD_SHA256).length
    expect(after).toBe(before)
    expect(readFileSync(join(vault.root, 'Thread.md'), 'utf-8')).toBe('Hi')
  })
})

// ---------------------------------------------------------------------------
// Task 2: an edit made outside Tapestry arrives as one observed cluster
// ---------------------------------------------------------------------------

describe('vault thread: an external edit arrives as one observed cluster', () => {
  let fixture: VaultThreadFixture | null = null

  afterEach(() => {
    fixture?.registry.closeAll()
    fixture?.vault.cleanup()
    fixture = null
  })

  it('records exactly one ins record with cause observed, attributed obsidian.bridge, at the observation time', async () => {
    fixture = await setUpVaultThread()
    const { tree, nodeId, actor } = fixture

    const writer = new ThreadService()
    writer.open(tree.bridge, actor, tree.id, nodeId)
    writer.push(tree.id, nodeId, actor, 0, [insertTextStepJson(1, 'Hello')], [1000], [null])
    writer.close(tree.id, nodeId)

    const before = tree.bridge.getPropertyValues(nodeId, 'thread.log').length

    // A fresh service stands in for the (not-yet-built) live watcher: it
    // knows nothing about `writer`'s in-memory state and must replay from
    // thread.log alone to learn the current text, exactly like a real
    // watcher process would.
    const watcher = new ThreadService()
    const result = observeVaultEdit(watcher, tree.bridge, OBSIDIAN_BRIDGE_ACTOR, tree.id, nodeId, 'Hello World')
    expect(result).toEqual({ changed: true })
    watcher.close(tree.id, nodeId) // forces the pending observed edit to flush

    const entries = tree.bridge.getPropertyValues(nodeId, 'thread.log')
    expect(entries.length).toBe(before + 1)

    const lastBlock = String(entries[entries.length - 1].value.value)
    const records = parseBlock(lastBlock)
    const observed = records.filter((r) => 'cause' in r && r.cause === 'observed')
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({ verb: 'ins', text: ' World' })

    expect(entries[entries.length - 1].actor).toEqual({ kind: 'plugin', id: 'obsidian.bridge' })
  })

  it('records nothing for a no-op rewrite of identical content', async () => {
    fixture = await setUpVaultThread()
    const { tree, nodeId, actor } = fixture

    const writer = new ThreadService()
    writer.open(tree.bridge, actor, tree.id, nodeId)
    writer.push(tree.id, nodeId, actor, 0, [insertTextStepJson(1, 'Hello World')], [1000], [null])
    writer.close(tree.id, nodeId)

    const before = tree.bridge.getPropertyValues(nodeId, 'thread.log').length

    const watcher = new ThreadService()
    const result = observeVaultEdit(watcher, tree.bridge, OBSIDIAN_BRIDGE_ACTOR, tree.id, nodeId, 'Hello World')
    expect(result).toEqual({ changed: false })
    watcher.close(tree.id, nodeId)

    expect(tree.bridge.getPropertyValues(nodeId, 'thread.log').length).toBe(before)
  })

  it('never spreads an observed edit across more than one record, even for a whole-document replace', async () => {
    fixture = await setUpVaultThread()
    const { tree, nodeId, actor } = fixture

    const writer = new ThreadService()
    writer.open(tree.bridge, actor, tree.id, nodeId)
    writer.push(tree.id, nodeId, actor, 0, [insertTextStepJson(1, 'Original text here')], [1000], [null])
    writer.close(tree.id, nodeId)

    const watcher = new ThreadService()
    const result = observeVaultEdit(
      watcher,
      tree.bridge,
      OBSIDIAN_BRIDGE_ACTOR,
      tree.id,
      nodeId,
      'Completely different content',
    )
    expect(result).toEqual({ changed: true })
    watcher.close(tree.id, nodeId)

    const entries = tree.bridge.getPropertyValues(nodeId, 'thread.log')
    const lastBlock = String(entries[entries.length - 1].value.value)
    const observed = parseBlock(lastBlock).filter((r) => 'cause' in r && r.cause === 'observed')
    expect(observed).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Task 2: a body checkpoint that disagrees with replay reconciles honestly
// ---------------------------------------------------------------------------

describe('a divergent body checkpoint is reconciled, not silently overwritten', () => {
  let tree: TempTree

  afterEach(() => {
    tree.cleanup()
  })

  it('records the difference as one observed cluster and keeps both sides', () => {
    tree = createTempTree('vault-thread-reconcile')
    const actor = humanActor('kaelen')
    tree.bridge.submitAs(actor, 'Create thread', [
      {
        op: 'createNode',
        type: 'tapestry.threads/thread@1',
        props: { body: { type: 'text', value: '' }, title: { type: 'text', value: '' } },
      },
    ])
    const nodeId = 'n1'

    const first = new ThreadService()
    first.open(tree.bridge, actor, 'tree', nodeId)
    first.push('tree', nodeId, actor, 0, [insertTextStepJson(1, 'Hi')], [1000], [null])
    first.close('tree', nodeId) // flushes thread.log ("Hi") and writes a matching body checkpoint

    // Simulate something writing straight to `body` outside ThreadService --
    // the no-plugin fallback path RESEARCH Pattern 6 describes, or any other
    // future writer of this key -- landing text replay does not know about.
    const divergentDoc = tapestrySchema.node('doc', null, [
      tapestrySchema.node('paragraph', null, [tapestrySchema.text('Hi there')]),
    ])
    tree.bridge.submitAs(actor, 'Simulate an external body edit', [
      { op: 'setProperty', target: nodeId, key: 'body', type: 'text', value: JSON.stringify(divergentDoc.toJSON()) },
    ])

    const before = tree.bridge.getPropertyValues(nodeId, 'thread.log').length

    // A fresh service: open() replays from thread.log alone, sees the body
    // checkpoint disagrees, and reconciles rather than picking a side.
    const reopened = new ThreadService()
    reopened.open(tree.bridge, actor, 'tree', nodeId)
    reopened.close('tree', nodeId) // forces the reconciliation's pending batch to flush

    const after = tree.bridge.getPropertyValues(nodeId, 'thread.log')
    expect(after.length).toBe(before + 1)

    const records = parseBlock(String(after[after.length - 1].value.value))
    const observed = records.filter((r) => 'cause' in r && r.cause === 'observed')
    expect(observed).toHaveLength(1)

    // Neither side was silently overwritten: replaying thread.log from
    // scratch now produces the union of both -- the originally typed "Hi"
    // plus the checkpoint's own addition.
    const finalService = new ThreadService()
    const flat = finalService.readFlatText(tree.bridge, actor, 'tree', nodeId)
    if ('error' in flat) throw new Error(flat.error)
    expect(flat.text).toBe('Hi there')
    finalService.close('tree', nodeId)
  })

  it('does not reconcile a brand-new thread whose checkpoint is still empty', () => {
    tree = createTempTree('vault-thread-reconcile-fresh')
    const actor = humanActor('kaelen')
    tree.bridge.submitAs(actor, 'Create thread', [
      {
        op: 'createNode',
        type: 'tapestry.threads/thread@1',
        props: { body: { type: 'text', value: '' }, title: { type: 'text', value: '' } },
      },
    ])
    const nodeId = 'n1'

    const service = new ThreadService()
    const opened = service.open(tree.bridge, actor, 'tree', nodeId)
    expect(opened.totalChanges).toBe(0)
    expect(tree.bridge.getPropertyValues(nodeId, 'thread.log').length).toBe(0)
    service.close('tree', nodeId)
  })
})
