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
import { join } from 'node:path'
import { rmSync, writeFileSync } from 'node:fs'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { KernelBridge } from '../kernel-bridge'
import { TreeRegistry } from './registry'

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
