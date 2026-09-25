/**
 * TreeRegistry: several trees open at once, each holding exactly one lock.
 *
 * The journal takes flock(LOCK_EX) for the life of an open world, so the
 * registry's job is to make sure one path is opened once and that closing a
 * tree really does release the file — otherwise reopening it later fails
 * nondeterministically, which is the bug this test exists to prevent.
 *
 * Note on identity: a tree's id is the digest of its header record, and the
 * header is `world <name>` plus `created <whole second>`. Two worlds created
 * with the same name in the same second therefore share an id, so these tests
 * give each world a distinct name and override the display name separately.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { KernelBridge } from '../kernel-bridge'
import { humanActor, pluginActor } from '../commands/actor'
import { TreeIdentityClash, TreeRegistry, type OpenTree, type UnavailableTree } from './registry'

const dirs: string[] = []
const registries: TreeRegistry[] = []

function tempDir(prefix: string): string {
  const dir = makeTempDir(prefix)
  dirs.push(dir)
  return dir
}

function newRegistry(): TreeRegistry {
  const registry = new TreeRegistry()
  registries.push(registry)
  return registry
}

afterEach(() => {
  while (registries.length > 0) {
    try {
      registries.pop()!.closeAll()
    } catch {
      // Already closed.
    }
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

describe('TreeRegistry', () => {
  it('returns the same entry when the same path is opened twice', () => {
    const dir = tempDir('reg-same')
    const path = join(dir, 'alpha.tree')
    const registry = newRegistry()

    const created = registry.create(path, 'alpha')
    const opened = registry.open(path)

    // Not merely equal — the same entry, holding the one lock.
    expect(opened).toBe(created)
    expect(registry.list()).toHaveLength(1)
  })

  it('holds two different trees open at once', () => {
    const dir = tempDir('reg-two')
    const registry = newRegistry()

    const alpha = registry.create(join(dir, 'alpha.tree'), 'alpha')
    const beta = registry.create(join(dir, 'beta.tree'), 'beta')

    expect(alpha.id).not.toBe(beta.id)
    expect(registry.list()).toHaveLength(2)
    expect(registry.get(alpha.id)).toBe(alpha)
    expect(registry.get(beta.id)).toBe(beta)

    // Both are genuinely usable, not just recorded.
    expect(alpha.bridge.getNodes()).toEqual([])
    expect(beta.bridge.getNodes()).toEqual([])
  })

  it('resolves a reference by id and by name, case-insensitively', () => {
    const dir = tempDir('reg-resolve')
    const registry = newRegistry()
    const alpha = registry.create(join(dir, 'alpha.tree'), 'alpha')

    expect(registry.resolveRef(alpha.id)).toBe(alpha)
    expect(registry.resolveRef('alpha')).toBe(alpha)
    expect(registry.resolveRef('ALPHA')).toBe(alpha)
    expect(registry.resolveRef('AlPhA')).toBe(alpha)
  })

  it('refuses an ambiguous name rather than guessing a tree', () => {
    const dir = tempDir('reg-ambiguous')
    const registry = newRegistry()

    // Distinct worlds (so distinct ids) that a person would call the same name.
    registry.create(join(dir, 'one.tree'), 'one', { name: 'Notes' })
    registry.create(join(dir, 'two.tree'), 'two', { name: 'notes' })

    expect(() => registry.resolveRef('Notes')).toThrow(
      'Tree name Notes is ambiguous; use the tree id',
    )
  })

  it('refuses an unknown reference', () => {
    const registry = newRegistry()
    expect(() => registry.resolveRef('nope')).toThrow('Unknown tree: nope')
  })

  it('releases the journal lock on close, so the file can be reopened', () => {
    const dir = tempDir('reg-lock')
    const path = join(dir, 'alpha.tree')
    const registry = newRegistry()

    const tree = registry.create(path, 'alpha')
    registry.close(tree.id)
    expect(registry.list()).toHaveLength(0)

    // The real proof: a fresh bridge can take the exclusive lock.
    const reopened = new KernelBridge()
    expect(() => reopened.open(path)).not.toThrow()
    reopened.close()
  })

  it('refuses a second path holding the same tree identity', () => {
    const dir = tempDir('reg-clash')
    const path = join(dir, 'alpha.tree')
    const registry = newRegistry()

    const tree = registry.create(path, 'alpha')

    // A byte-for-byte copy carries the same header, so the same id.
    const copyPath = join(dir, 'copy.tree')
    writeFileSync(copyPath, require('node:fs').readFileSync(path))

    expect(() => registry.open(copyPath)).toThrow(/is already open from/)
    // The original is untouched and still usable.
    expect(registry.get(tree.id)).toBe(tree)
  })

  it('reports the most recently opened native tree as primary', () => {
    const dir = tempDir('reg-primary')
    const registry = newRegistry()

    const alpha = registry.create(join(dir, 'alpha.tree'), 'alpha')
    expect(registry.primary()).toBe(alpha)

    const beta = registry.create(join(dir, 'beta.tree'), 'beta')
    expect(registry.primary()).toBe(beta)

    registry.setPrimary(alpha.id)
    expect(registry.primary()).toBe(alpha)

    // Closing the primary falls back rather than leaving a dangling id.
    registry.close(alpha.id)
    expect(registry.primary()).toBe(beta)
  })

  it('keeps each tree to its own journal, and its own lock', () => {
    const dir = tempDir('reg-journals')
    const registry = newRegistry()

    // Distinct world names: the id is the header digest, and the header is the
    // world name plus its creation time rounded to the second, so two worlds
    // named alike in the same second would collide (see the note above).
    const alphaPath = join(dir, 'alpha.tree')
    const betaPath = join(dir, 'beta.tree')
    const alpha = registry.create(alphaPath, 'alpha')
    const beta = registry.create(betaPath, 'beta')

    alpha.bridge.submitAs(humanActor('kaelen'), 'note in alpha', [
      { op: 'createNode', type: 'tapestry.notes/note@1', props: {} },
    ])
    beta.bridge.submitAs(humanActor('kaelen'), 'note in beta', [
      { op: 'createNode', type: 'tapestry.notes/note@1', props: {} },
    ])

    // The real proof is on disk: each commit message appears in exactly one
    // file. A shared bridge would put both in whichever tree was primary.
    const alphaText = readFileSync(alphaPath, 'utf-8')
    const betaText = readFileSync(betaPath, 'utf-8')

    expect(alphaText).toContain('note in alpha')
    expect(alphaText).not.toContain('note in beta')
    expect(betaText).toContain('note in beta')
    expect(betaText).not.toContain('note in alpha')

    // Each open tree holds its own exclusive journal lock, so neither file can
    // be opened a second time while the space has it.
    for (const path of [alphaPath, betaPath]) {
      const intruder = new KernelBridge()
      expect(() => intruder.open(path)).toThrow()
      intruder.close()
    }

    // closeAll releases both, so a later launch can reopen the whole space.
    registry.closeAll()
    for (const path of [alphaPath, betaPath]) {
      const reopened = new KernelBridge()
      expect(() => reopened.open(path)).not.toThrow()
      reopened.close()
    }
  })

  it('summarises open trees without their bridges', () => {
    const dir = tempDir('reg-summary')
    const registry = newRegistry()

    const alpha = registry.create(join(dir, 'alpha.tree'), 'alpha')

    // `status` is part of every summary now: the renderer draws unavailable
    // trees from the same list, so an open tree has to say that it is open.
    expect(registry.summary()).toEqual([
      { id: alpha.id, name: 'alpha', kind: 'native', path: alpha.path, status: 'ok' },
    ])
  })

  it('forwards the plugin facade to whichever tree is primary', () => {
    const dir = tempDir('reg-proxy')
    const registry = newRegistry()
    const proxy = registry.primaryBridgeProxy()

    // With nothing open there is no world to write into, and the facade says
    // so rather than quietly doing nothing.
    expect(proxy.isLoaded).toBe(false)
    expect(() => proxy.getNodes()).toThrow('No kernel loaded')

    const alpha = registry.create(join(dir, 'alpha.tree'), 'alpha')
    expect(proxy.isLoaded).toBe(true)
    proxy.submitAs(pluginActor('example'), 'from a plugin', [
      { op: 'createNode', type: 'tapestry.notes/note@1', props: {} },
    ])
    expect(proxy.getNodes()).toHaveLength(1)

    // Opening a second world moves the facade with the primary, so a plugin
    // loaded before it existed does not keep writing into the old tree.
    const beta = registry.create(join(dir, 'beta.tree'), 'beta')
    expect(registry.primary()).toBe(beta)
    expect(proxy.getNodes()).toEqual([])
    expect(alpha.bridge.getNodes()).toHaveLength(1)
  })

  it('notifies subscribers when trees open and close', () => {
    const dir = tempDir('reg-onchange')
    const registry = newRegistry()

    let changes = 0
    const unsubscribe = registry.onChange(() => {
      changes += 1
    })

    const tree = registry.create(join(dir, 'alpha.tree'), 'alpha')
    expect(changes).toBe(1)

    registry.close(tree.id)
    expect(changes).toBe(2)

    unsubscribe()
    registry.create(join(dir, 'beta.tree'), 'beta')
    expect(changes).toBe(2)
  })
})

/**
 * Trees that will not open (D-15, T-02.2-29/32).
 *
 * A tree whose file is damaged, locked by another Tapestry or missing must
 * stay in the space with a reason rather than disappearing: a frame that
 * silently vanished would be indistinguishable from a world that was lost.
 * None of these may ever be written to, and none is ever repaired here —
 * repair is an explicit act outside this registry (Phase 1 PD-04).
 */
describe('TreeRegistry: trees that will not open', () => {
  /** A world with one commit, closed, then truncated mid-record. */
  function makeDamagedTree(dir: string): string {
    const path = join(dir, 'damaged.tree')
    const registry = new TreeRegistry()
    const tree = registry.create(path, 'damaged')
    tree.bridge.submitAs(humanActor('kaelen'), 'a note to tear', [
      { op: 'createNode', type: 'tapestry.notes/note@1', props: {} },
    ])
    // Release the lock before cutting the file, so the truncation is the only
    // thing wrong with it.
    registry.closeAll()

    const { size } = statSync(path)
    truncateSync(path, size - 5)
    return path
  }

  it('keeps a damaged tree, with the kernel reason, and refuses to write to it', () => {
    const dir = tempDir('reg-damaged')
    const path = makeDamagedTree(dir)
    const sizeBefore = statSync(path).size

    const registry = newRegistry()
    const entry = registry.tryOpen(path)

    expect('bridge' in entry).toBe(false)
    const unavailable = entry as UnavailableTree
    expect(unavailable.status).toBe('damaged')
    expect(unavailable.reason.length).toBeGreaterThan(0)
    expect(unavailable.path).toBe(resolve(path))

    // The refusal is the point: a damaged journal must never be appended to.
    expect(registry.refusalFor(unavailable.id)).toContain(
      'This tree is damaged; Tapestry will not write to it',
    )

    // Nothing was repaired and nothing was written, so the file is untouched.
    expect(statSync(path).size).toBe(sizeBefore)
    // The registry kept no handle on it. A torn journal still *opens* — the
    // kernel loads the verified prefix and refuses appends — so this open
    // succeeding is what proves the lock was released, not that the file is
    // healthy. Were a bridge still held, this would fail on the lock instead,
    // and a later explicit repair could never get at the file.
    const after = new KernelBridge()
    expect(() => after.open(path)).not.toThrow()
    expect(after.status().kind).not.toBe('Ok')
    after.close()
  })

  it('reports a tree already locked by another Tapestry as locked', () => {
    const dir = tempDir('reg-locked')
    const path = join(dir, 'held.tree')

    // A separate bridge stands in for the other Tapestry window: flock is per
    // open file description, so a second open is refused in this process too.
    const holder = new KernelBridge()
    holder.create(path, 'held')

    const registry = newRegistry()
    const entry = registry.tryOpen(path) as UnavailableTree

    expect(entry.status).toBe('locked')
    expect(registry.refusalFor(entry.id)).toContain('Tapestry will not write to it')

    holder.close()
  })

  it('reports a path with no file as missing', () => {
    const dir = tempDir('reg-missing')
    const registry = newRegistry()

    const entry = registry.tryOpen(join(dir, 'gone.tree')) as UnavailableTree

    expect(entry.status).toBe('missing')
    expect(entry.reason.length).toBeGreaterThan(0)
  })

  it('reopens an unavailable tree once the cause is gone', () => {
    const dir = tempDir('reg-reopen')
    const path = join(dir, 'held.tree')

    const holder = new KernelBridge()
    holder.create(path, 'held')

    const registry = newRegistry()
    const blocked = registry.tryOpen(path) as UnavailableTree
    expect(blocked.status).toBe('locked')

    // The other window closes its copy; the retry is Kaelen's, not a loop.
    holder.close()
    const reopened = registry.reopen(blocked.id)

    expect(reopened).not.toBeNull()
    expect('bridge' in (reopened as object)).toBe(true)
    expect((reopened as OpenTree).bridge.getNodes()).toEqual([])
    // It is a real member of the space now, not a leftover unavailable entry.
    expect(registry.refusalFor((reopened as OpenTree).id)).toBeNull()
    expect(registry.summary().map((tree) => tree.status)).toEqual(['ok'])
  })

  it('lists unavailable entries with their status, and closes them', () => {
    const dir = tempDir('reg-unavailable-list')
    const path = makeDamagedTree(dir)

    const registry = newRegistry()
    const entry = registry.tryOpen(path) as UnavailableTree

    // The id names the path, because a tree that would not open has no header
    // digest to be named by.
    expect(entry.id).toBe(`path:${resolve(path)}`)

    expect(registry.summary()).toEqual([
      {
        id: entry.id,
        name: 'damaged',
        kind: 'native',
        path: resolve(path),
        status: 'damaged',
        reason: entry.reason,
      },
    ])

    // An open tree's bridge-bearing list stays free of entries that have none.
    expect(registry.list()).toHaveLength(0)

    registry.close(entry.id)
    expect(registry.summary()).toEqual([])
  })
})

describe('TreeRegistry: a world read at a path ends its never-read record (2.6 gap 2, CR-02)', () => {
  function pathIds(registry: TreeRegistry): string[] {
    return registry
      .summary()
      .map((t) => t.id)
      .filter((id) => id.startsWith('path:'))
  }

  it('create at a path with a never-read record clears it', () => {
    const dir = tempDir('reg-create-clears')
    const missingPath = join(dir, 'later.tree')
    const registry = newRegistry()

    const missing = registry.tryOpen(missingPath) as UnavailableTree
    expect(missing.id).toBe(`path:${resolve(missingPath)}`)

    const created = registry.create(missingPath, 'create-clears')

    expect(pathIds(registry)).toEqual([])
    expect(registry.entry(missing.id)).toBeNull()
    expect(registry.summary()).toEqual([expect.objectContaining({ id: created.id, status: 'ok' })])
  })

  it('open at a path with a never-read record clears it', () => {
    const dir = tempDir('reg-open-clears')
    const missingPath = join(dir, 'later.tree')
    const registry = newRegistry()

    registry.tryOpen(missingPath)
    expect(pathIds(registry)).toEqual([`path:${resolve(missingPath)}`])

    const maker = new KernelBridge()
    maker.create(missingPath, 'open-clears')
    maker.close()

    const opened = registry.open(missingPath)

    expect(pathIds(registry)).toEqual([])
    expect(registry.summary()).toEqual([expect.objectContaining({ id: opened.id, status: 'ok' })])
  })
})

describe('TreeRegistry: identity clash by type (2.6 Pitfall 10)', () => {
  it('throws a TreeIdentityClash naming the open tree, with the same message', () => {
    const dir = tempDir('reg-clash-type')
    const path = join(dir, 'clash-alpha.tree')
    const registry = newRegistry()
    const tree = registry.create(path, 'clash-alpha')

    const copyPath = join(dir, 'clash-copy.tree')
    copyFileSync(path, copyPath)

    let caught: unknown
    try {
      registry.open(copyPath)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(TreeIdentityClash)
    expect(caught).toBeInstanceOf(Error)
    const clash = caught as TreeIdentityClash
    expect(clash.treeId).toBe(tree.id)
    expect(clash.openPath).toBe(tree.path)
    expect(clash.openName).toBe(tree.name)
    expect(clash.message).toBe(`${tree.name} is already open from ${tree.path}`)
    expect(registry.list()).toHaveLength(1)
  })
})

describe('TreeRegistry: an expected identity (2.6 D-03, Pitfall 5)', () => {
  /** A world created and closed again, so a later open is the first holder. */
  function closedWorld(prefix: string, name: string): { path: string; id: string } {
    const dir = tempDir(prefix)
    const path = join(dir, `${name}.tree`)
    const bridge = new KernelBridge()
    bridge.create(path, name)
    const id = bridge.getHeaderDigest()
    bridge.close()
    return { path, id }
  }

  const reason = 'A different tree now sits at this path'

  it('records a different world at the path as missing, with the caller reason, and holds nothing', () => {
    const { path } = closedWorld('reg-expect-diff', 'expect-diff')
    const bytesBefore = readFileSync(path)
    const registry = newRegistry()

    const entry = registry.tryOpen(path, {
      expect: { id: 'sha256:0000000000000000000000000000000000000000000000000000000000000000', reason },
    }) as UnavailableTree

    expect('bridge' in entry).toBe(false)
    expect(entry.status).toBe('missing')
    expect(entry.reason).toBe(reason)
    expect(registry.list()).toHaveLength(0)
    // The expectation is kept for a retry but never shown to the renderer.
    expect(registry.summary()).toEqual([
      {
        id: entry.id,
        name: 'expect-diff',
        kind: 'native',
        path: resolve(path),
        status: 'missing',
        reason,
      },
    ])

    // The lock was released and nothing was written.
    const fresh = new KernelBridge()
    expect(() => fresh.open(path)).not.toThrow()
    fresh.close()
    expect(readFileSync(path).equals(bytesBefore)).toBe(true)
  })

  it('keeps the expectation on reopen, so the same mismatch stays missing', () => {
    const { path } = closedWorld('reg-expect-reopen', 'expect-reopen')
    const registry = newRegistry()
    const expect_ = { id: 'sha256:not-this-world', reason }

    const first = registry.tryOpen(path, { expect: expect_ }) as UnavailableTree
    const again = registry.reopen(first.id) as UnavailableTree

    expect(again).not.toBeNull()
    expect('bridge' in again).toBe(false)
    expect(again.status).toBe('missing')
    expect(again.reason).toBe(reason)
    expect(again.expect).toEqual(expect_)
  })

  it('opens normally when the digest is the one expected', () => {
    const { path, id } = closedWorld('reg-expect-match', 'expect-match')
    const registry = newRegistry()

    const tree = registry.tryOpen(path, { expect: { id, reason } }) as OpenTree

    expect('bridge' in tree).toBe(true)
    expect(tree.id).toBe(id)
    expect(registry.summary().map((entry) => entry.status)).toEqual(['ok'])
  })
})

describe('TreeRegistry: unavailable records keyed by expected identity (2.6 gap 3)', () => {
  /** A world created and closed again, so a later open is the first holder. */
  function closedWorld(prefix: string, name: string): { dir: string; path: string; id: string } {
    const dir = tempDir(prefix)
    const path = join(dir, `${name}.tree`)
    const bridge = new KernelBridge()
    bridge.create(path, name)
    const id = bridge.getHeaderDigest()
    bridge.close()
    return { dir, path, id }
  }

  const reason = 'A different world is now at this path'
  const fakeA = 'sha256:' + 'a'.repeat(64)
  const fakeB = 'sha256:' + 'b'.repeat(64)

  it('names a mismatch by the expected id, and a failed open without expect by path', () => {
    const { dir, path } = closedWorld('reg-key-expect', 'key-expect')
    const registry = newRegistry()

    const mismatch = registry.tryOpen(path, { expect: { id: fakeA, reason } }) as UnavailableTree
    expect(mismatch.id).toBe(fakeA)
    expect(mismatch.status).toBe('missing')

    const gone = registry.tryOpen(join(dir, 'gone.tree')) as UnavailableTree
    expect(gone.id).toBe(`path:${resolve(join(dir, 'gone.tree'))}`)
  })

  it('lists two members expected at one path separately, both missing', () => {
    const { path } = closedWorld('reg-key-two', 'key-two')
    const registry = newRegistry()

    registry.tryOpen(path, { expect: { id: fakeA, reason } })
    registry.tryOpen(path, { expect: { id: fakeB, reason } })

    const listed = registry.summary()
    expect(listed.map((t) => t.id)).toEqual([fakeA, fakeB])
    expect(listed.map((t) => t.status)).toEqual(['missing', 'missing'])
    expect(registry.list()).toHaveLength(0)
  })

  it("keeps a member's record when a different world is opened at its path", () => {
    const y = closedWorld('reg-key-keep', 'key-keep')
    const registry = newRegistry()

    registry.tryOpen(y.path, { expect: { id: fakeA, reason } })
    const opened = registry.open(y.path)

    expect(opened.id).toBe(y.id)
    expect(registry.summary()).toEqual([
      expect.objectContaining({ id: y.id, status: 'ok' }),
      expect.objectContaining({ id: fakeA, status: 'missing', reason }),
    ])
  })

  it("ends a member's record when it is opened from another path", () => {
    const w = closedWorld('reg-key-found', 'key-found')
    const registry = newRegistry()
    const oldPath = join(w.dir, 'old.tree')

    const missing = registry.tryOpen(oldPath, { expect: { id: w.id, reason } }) as UnavailableTree
    expect(missing.id).toBe(w.id)
    expect(registry.get(w.id)).toBeNull()

    registry.open(w.path)

    expect(registry.summary()).toEqual([expect.objectContaining({ id: w.id, status: 'ok' })])
    expect(registry.refusalFor(w.id)).toBeNull()
  })

  it('honours expect when a different world is already open at the path', () => {
    const y = closedWorld('reg-key-shortcut', 'key-shortcut')
    const registry = newRegistry()
    const open = registry.open(y.path)

    const other = registry.tryOpen(y.path, { expect: { id: fakeA, reason } }) as UnavailableTree
    expect('bridge' in other).toBe(false)
    expect(other).toEqual(expect.objectContaining({ id: fakeA, status: 'missing', reason }))
    expect(registry.get(y.id)).toBe(open)

    expect(registry.tryOpen(y.path, { expect: { id: y.id, reason } })).toBe(open)
    expect(registry.summary().map((t) => [t.id, t.status])).toEqual([
      [y.id, 'ok'],
      [fakeA, 'missing'],
    ])
  })

  it('refuses an expected id that is open elsewhere, and records nothing', () => {
    const w = closedWorld('reg-key-clash', 'key-clash')
    const registry = newRegistry()
    registry.open(w.path)
    const elsewhere = join(w.dir, 'elsewhere.tree')

    let caught: unknown
    try {
      registry.tryOpen(elsewhere, { expect: { id: w.id, reason } })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(TreeIdentityClash)
    expect((caught as TreeIdentityClash).treeId).toBe(w.id)
    expect(registry.unavailableList()).toEqual([])
    expect(registry.summary()).toEqual([expect.objectContaining({ id: w.id, status: 'ok' })])
  })

  it('keeps the digest id through reopen while the mismatch persists', () => {
    const { path } = closedWorld('reg-key-reopen', 'key-reopen')
    const registry = newRegistry()

    const first = registry.tryOpen(path, { expect: { id: fakeA, reason } }) as UnavailableTree
    const again = registry.reopen(first.id) as UnavailableTree

    expect(again.id).toBe(fakeA)
    expect(registry.summary().map((t) => t.id)).toEqual([fakeA])
  })
})

describe("TreeRegistry: Tapestry's own files are reserved (2.6 Pitfall 4)", () => {
  const refusal = (name: string): string => `refused: ${name}`

  function closedWorld(dir: string, name: string): { path: string; id: string } {
    const path = join(dir, `${name}.tree`)
    const bridge = new KernelBridge()
    bridge.create(path, name)
    const id = bridge.getHeaderDigest()
    bridge.close()
    return { path, id }
  }

  it('refuses a reserved path through open, create and tryOpen, recording nothing', () => {
    const dir = tempDir('reg-reserved-path')
    const { path } = closedWorld(dir, 'reserved-forest')
    const unborn = join(dir, 'reserved-unborn.tree')
    const registry = newRegistry()
    registry.setReserved({ paths: [path, unborn], ids: [], refusal })

    expect(() => registry.open(path)).toThrow('refused: reserved-forest.tree')
    expect(() => registry.create(path, 'again')).toThrow('refused: reserved-forest.tree')
    expect(() => registry.tryOpen(path)).toThrow('refused: reserved-forest.tree')
    expect(() => registry.create(unborn, 'reserved-unborn')).toThrow(
      'refused: reserved-unborn.tree',
    )

    expect(existsSync(unborn)).toBe(false)
    expect(registry.summary()).toEqual([])
    // No lock was taken on the reserved file.
    const fresh = new KernelBridge()
    expect(() => fresh.open(path)).not.toThrow()
    fresh.close()
  })

  it('refuses a symlink that points at a reserved path', () => {
    const dir = tempDir('reg-reserved-link')
    const { path } = closedWorld(dir, 'reserved-linked')
    const link = join(dir, 'reserved-link.tree')
    symlinkSync(path, link)
    const registry = newRegistry()
    registry.setReserved({ paths: [path], ids: [], refusal })

    expect(() => registry.open(link)).toThrow('refused: reserved-link.tree')
    expect(() => registry.tryOpen(link)).toThrow('refused: reserved-link.tree')
    expect(registry.summary()).toEqual([])
  })

  it('refuses a path reached through a symlinked folder, even when reserved before the file exists', () => {
    const dir = tempDir('reg-reserved-folder')
    const realFolder = join(dir, 'real')
    const linkedFolder = join(dir, 'linked')
    mkdirSync(realFolder)
    symlinkSync(realFolder, linkedFolder)
    const registry = newRegistry()
    // Reserved by its real-folder path while it does not exist yet.
    registry.setReserved({ paths: [join(realFolder, 'Forest.tree')], ids: [], refusal })

    closedWorld(realFolder, 'Forest')

    expect(() => registry.open(join(linkedFolder, 'Forest.tree'))).toThrow('refused: Forest.tree')
    expect(registry.summary()).toEqual([])
  })

  it('refuses a copy carrying a reserved identity and holds no lock on it', () => {
    const dir = tempDir('reg-reserved-id')
    const { path, id } = closedWorld(dir, 'reserved-id')
    const copy = join(dir, 'reserved-copy.tree')
    copyFileSync(path, copy)
    const registry = newRegistry()
    registry.setReserved({ paths: [], ids: [id], refusal })

    expect(() => registry.open(copy)).toThrow('refused: reserved-copy.tree')
    expect(() => registry.tryOpen(copy)).toThrow('refused: reserved-copy.tree')
    expect(registry.summary()).toEqual([])

    const fresh = new KernelBridge()
    expect(() => fresh.open(copy)).not.toThrow()
    fresh.close()
  })

  it('setReserved(null) removes both refusals', () => {
    const dir = tempDir('reg-reserved-clear')
    const { path, id } = closedWorld(dir, 'reserved-clear')
    const copy = join(dir, 'reserved-clear-copy.tree')
    copyFileSync(path, copy)
    const registry = newRegistry()
    registry.setReserved({ paths: [path], ids: [id], refusal })

    expect(() => registry.open(path)).toThrow('refused: reserved-clear.tree')
    expect(() => registry.open(copy)).toThrow('refused: reserved-clear-copy.tree')

    registry.setReserved(null)

    const original = registry.open(path)
    expect(original.id).toBe(id)
    registry.close(original.id)
    expect(registry.open(copy).id).toBe(id)
  })
})
