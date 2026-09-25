/**
 * openWithRollback against the real registry and addon (2.6 WR-02, T-2.6-24).
 *
 * After an add fails anywhere, inside `open()` or while recording the tree in
 * the forest, every registry entry the call introduced with no stand-in is
 * closed again. An entry that existed before, or that the forest holds, is
 * kept. The original error is rethrown unchanged.
 *
 * Every path is under a temp directory (T-2.6-DATA). The vault path is a
 * missing temp path, never a real vault. Each temp world gets a distinct name,
 * because two worlds created with one name in the same second share an id.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { KernelBridge } from '../kernel-bridge'
import { TreeRegistry } from '../trees/registry'
import { openWithRollback } from './open-into-space'

const dirs: string[] = []
const registries: TreeRegistry[] = []

afterEach(() => {
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

/** Create a world with a distinct name and release it again. */
function makeWorld(dir: string, file: string): string {
  worldCounter += 1
  const path = join(dir, file)
  const bridge = new KernelBridge()
  bridge.create(path, `${file.replace(/\.tree$/, '')}-${process.pid}-${worldCounter}`)
  bridge.close()
  return path
}

function ids(registry: TreeRegistry): string[] {
  return registry
    .summary()
    .map((t) => t.id)
    .sort()
}

/** A registry already holding one open world, the entry that existed before. */
function withExisting(prefix: string) {
  const dir = tempDir(prefix)
  const registry = newRegistry()
  const existing = registry.open(makeWorld(dir, 'existing.tree'), { kind: 'native' })
  return { dir, registry, existing }
}

describe('openWithRollback (2.6 WR-02, T-2.6-24)', () => {
  it('a vault tree that will not open inside open() leaves no registry entry', async () => {
    const { dir, registry, existing } = withExisting('rollback-vault')
    const before = ids(registry)
    let recorded = false
    const failure = new Error("This tree's file cannot be found")

    const add = openWithRollback(registry, {
      open: () => {
        // What VaultService.addVault does for a vault tree that will not open:
        // tryOpen records it unavailable, then requireOpen throws.
        registry.tryOpen(join(dir, 'Vault', 'Vault.tree'), {
          kind: 'vault',
          vaultRoot: join(dir, 'Vault'),
          name: 'Vault',
        })
        expect(ids(registry)).toHaveLength(before.length + 1)
        throw failure
      },
      record: () => {
        recorded = true
      },
      isMember: () => false,
    })

    await expect(add).rejects.toBe(failure)
    expect(failure.message).toBe("This tree's file cannot be found")
    expect(recorded).toBe(false)
    expect(ids(registry)).toEqual(before)
    expect(registry.get(existing.id)).toBe(existing)
  })

  it('a failed catch-up after adoption closes the tree and releases its journal lock', async () => {
    const { dir, registry, existing } = withExisting('rollback-catchup')
    const before = ids(registry)
    const path = makeWorld(dir, 'adopted.tree')
    const failure = new Error('catch-up failed')
    let adoptedId: string | undefined

    const add = openWithRollback(registry, {
      open: async () => {
        adoptedId = registry.open(path, { kind: 'vault', vaultRoot: dir, name: 'Adopted' }).id
        throw failure
      },
      record: () => {
        throw new Error('record must not run')
      },
      isMember: () => false,
    })

    await expect(add).rejects.toBe(failure)
    expect(adoptedId).toBeDefined()
    expect(registry.entry(adoptedId!)).toBeNull()
    expect(ids(registry)).toEqual(before)
    expect(registry.get(existing.id)).toBe(existing)

    // The real proof: a fresh bridge can take the exclusive lock (T-2.6-41).
    const reopened = new KernelBridge()
    expect(() => reopened.open(path)).not.toThrow()
    reopened.close()
  })

  it('a forest write failure in record closes the newly adopted tree and rethrows unchanged', async () => {
    const { dir, registry, existing } = withExisting('rollback-record')
    const before = ids(registry)
    const path = makeWorld(dir, 'fresh.tree')
    const failure = new Error('forest write failed')
    let recordedId: string | undefined

    const add = openWithRollback(registry, {
      open: () => registry.open(path, { kind: 'native' }),
      record: (entry) => {
        recordedId = entry.id
        throw failure
      },
      isMember: () => false,
    })

    await expect(add).rejects.toBe(failure)
    expect(failure.message).toBe('forest write failed')
    expect(recordedId).toBeDefined()
    expect(registry.entry(recordedId!)).toBeNull()
    expect(ids(registry)).toEqual(before)
    expect(registry.get(existing.id)).toBe(existing)

    const reopened = new KernelBridge()
    expect(() => reopened.open(path)).not.toThrow()
    reopened.close()
  })

  it('keeps an entry that existed before the call, even when open() returns it', async () => {
    const { registry, existing } = withExisting('rollback-existing')
    const before = ids(registry)
    const failure = new Error('forest write failed')

    const add = openWithRollback(registry, {
      // The path is already open, so the registry returns the same entry.
      open: () => registry.open(existing.path, { kind: 'native' }),
      record: (entry) => {
        expect(entry).toBe(existing)
        throw failure
      },
      isMember: () => false,
    })

    await expect(add).rejects.toBe(failure)
    expect(ids(registry)).toEqual(before)
    expect(registry.get(existing.id)).toBe(existing)
    expect(() => existing.bridge.status()).not.toThrow()
  })

  it('keeps an entry the forest holds (a concurrent add that succeeded) and closes its own', async () => {
    const { dir, registry, existing } = withExisting('rollback-concurrent')
    const w1Path = makeWorld(dir, 'w1.tree')
    const w2Path = makeWorld(dir, 'w2.tree')
    const failure = new Error('catch-up failed')
    let w1Id: string | undefined
    let w2Id: string | undefined
    const asked: string[] = []

    const add = openWithRollback(registry, {
      open: async () => {
        // This call's own world, then another add's world that reached the
        // forest while this one was still catching up.
        w1Id = registry.open(w1Path, { kind: 'vault', vaultRoot: dir, name: 'W1' }).id
        w2Id = registry.open(w2Path, { kind: 'native' }).id
        throw failure
      },
      record: () => {
        throw new Error('record must not run')
      },
      isMember: (id) => {
        asked.push(id)
        return id === w2Id
      },
    })

    await expect(add).rejects.toBe(failure)
    expect(w1Id).toBeDefined()
    expect(w2Id).toBeDefined()
    expect(w1Id).not.toBe(w2Id)
    expect(registry.entry(w1Id!)).toBeNull()
    expect(registry.get(w2Id!)?.path).toBe(resolve(w2Path))
    expect(registry.get(existing.id)).toBe(existing)
    expect(ids(registry)).toEqual([existing.id, w2Id!].sort())
    // Only the call's new entries are asked about; the pre-existing one is not.
    expect(asked.sort()).toEqual([w1Id!, w2Id!].sort())

    const reopened = new KernelBridge()
    expect(() => reopened.open(w1Path)).not.toThrow()
    reopened.close()
  })
})
