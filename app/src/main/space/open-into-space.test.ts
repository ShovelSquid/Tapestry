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
import { join } from 'node:path'
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
})
