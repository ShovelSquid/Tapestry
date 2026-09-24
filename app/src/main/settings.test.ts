/**
 * settings.json is a plain file the user can edit by hand, so every read is
 * treated as untrusted input. These tests pin the two things that matter:
 * a name that survives a restart, and a malformed file that costs nothing.
 *
 * The user name ends up inside an `actor` line, which is why an invalid one
 * must never round-trip (threat T-02.2-03).
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { SettingsStore, suggestUserName } from './settings'
import { makeTempDir } from '../../test/helpers/temp-tree'

/** Run `body` with a fresh temp userData directory, then delete it. */
function withTempDir(body: (dir: string) => void): void {
  const dir = makeTempDir('settings')
  try {
    body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('SettingsStore defaults', () => {
  it('reads defaults from an empty directory', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      const read = settings.read()

      expect(read.userName).toBeNull()
      expect(read.agentsEnabled).toBe(true)
      expect(read.trees).toEqual([])
      expect(settings.path).toBe(join(dir, 'settings.json'))
    })
  })
})

describe('SettingsStore.setUserName', () => {
  it('persists across stores', () => {
    withTempDir((dir) => {
      new SettingsStore(dir).setUserName('kaelen')

      expect(new SettingsStore(dir).getUserName()).toBe('kaelen')
    })
  })

  it('refuses a name that cannot be an actor id and writes nothing', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      settings.setUserName('kaelen')
      const before = readFileSync(settings.path, 'utf-8')

      expect(() => settings.setUserName('Kaelen Cook')).toThrow('Invalid user name')

      expect(readFileSync(settings.path, 'utf-8')).toBe(before)
      expect(settings.getUserName()).toBe('kaelen')
    })
  })

  it('does not create a file when the very first name is invalid', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)

      expect(() => settings.setUserName('Kaelen Cook')).toThrow('Invalid user name')

      expect(existsSync(settings.path)).toBe(false)
    })
  })
})

describe('SettingsStore.read validation', () => {
  it('reads an unparseable file as defaults', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFileSync(settings.path, '{', 'utf-8')

      const read = settings.read()
      expect(read.userName).toBeNull()
      expect(read.agentsEnabled).toBe(true)
      expect(read.trees).toEqual([])
    })
  })

  it('reads a hand-edited invalid userName as null', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFileSync(
        settings.path,
        JSON.stringify({ version: 1, userName: 'kaelen cook', agentsEnabled: true, trees: [] }),
        'utf-8',
      )

      expect(settings.getUserName()).toBeNull()
    })
  })

  it('drops a tree entry with a relative path and keeps the valid ones', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFileSync(
        settings.path,
        JSON.stringify({
          version: 1,
          userName: 'kaelen',
          agentsEnabled: true,
          trees: [
            { path: 'relative/we.tree', kind: 'native', frame: { x: 0, y: 0 } },
            { path: '/tmp/ok.tree', kind: 'native', frame: { x: 10, y: 20 } },
          ],
        }),
        'utf-8',
      )

      const read = settings.read()
      expect(read.trees).toEqual([
        { path: '/tmp/ok.tree', kind: 'native', frame: { x: 10, y: 20 } },
      ])
    })
  })

  it('drops tree entries with a bad kind, a ".." segment or a non-numeric frame', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFileSync(
        settings.path,
        JSON.stringify({
          version: 1,
          userName: 'kaelen',
          agentsEnabled: true,
          trees: [
            { path: '/tmp/a.tree', kind: 'sideways', frame: { x: 0, y: 0 } },
            { path: '/tmp/../etc/b.tree', kind: 'native', frame: { x: 0, y: 0 } },
            { path: '/tmp/c.tree', kind: 'native', frame: { x: 'left', y: 0 } },
            { path: '/tmp/d.txt', kind: 'native', frame: { x: 0, y: 0 } },
            { path: '/tmp/e.tree', kind: 'vault', vaultRoot: 'relative', frame: { x: 0, y: 0 } },
          ],
        }),
        'utf-8',
      )

      expect(settings.read().trees).toEqual([])
    })
  })

  it('keeps a valid vault tree with its vaultRoot', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFileSync(
        settings.path,
        JSON.stringify({
          version: 1,
          userName: 'kaelen',
          agentsEnabled: false,
          trees: [
            {
              path: '/tmp/vault/vault.tree',
              kind: 'vault',
              vaultRoot: '/tmp/vault',
              frame: { x: -5, y: 7 },
            },
          ],
        }),
        'utf-8',
      )

      const read = settings.read()
      expect(read.agentsEnabled).toBe(false)
      expect(read.trees).toEqual([
        {
          path: '/tmp/vault/vault.tree',
          kind: 'vault',
          vaultRoot: '/tmp/vault',
          frame: { x: -5, y: 7 },
        },
      ])
    })
  })
})

describe('SettingsStore tree frames', () => {
  it('round-trips a frame move and a removal', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      settings.addTree({ path: '/tmp/alpha.tree', kind: 'native', frame: { x: 0, y: 0 } })
      settings.addTree({ path: '/tmp/beta.tree', kind: 'native', frame: { x: 544, y: 0 } })

      settings.setTreeFrame('/tmp/alpha.tree', { x: -120, y: 80 })

      // Read through a fresh store: the point is that it reached the file.
      expect(new SettingsStore(dir).read().trees).toEqual([
        { path: '/tmp/alpha.tree', kind: 'native', frame: { x: -120, y: 80 } },
        { path: '/tmp/beta.tree', kind: 'native', frame: { x: 544, y: 0 } },
      ])

      settings.removeTree('/tmp/alpha.tree')

      expect(new SettingsStore(dir).read().trees).toEqual([
        { path: '/tmp/beta.tree', kind: 'native', frame: { x: 544, y: 0 } },
      ])
    })
  })

  it('does not move a tree that is already recorded', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      settings.addTree({ path: '/tmp/alpha.tree', kind: 'native', frame: { x: 10, y: 20 } })
      settings.addTree({ path: '/tmp/alpha.tree', kind: 'native', frame: { x: 999, y: 999 } })

      expect(settings.read().trees).toEqual([
        { path: '/tmp/alpha.tree', kind: 'native', frame: { x: 10, y: 20 } },
      ])
    })
  })
})

describe('SettingsStore.migrateLastOpened', () => {
  /** Write a Phase 2 last-opened.json pointing at a real (empty) .tree file. */
  function writeLastOpened(dir: string, treePath: string): string {
    const lastOpened = join(dir, 'last-opened.json')
    writeFileSync(lastOpened, JSON.stringify({ path: treePath }), 'utf-8')
    return lastOpened
  }

  it('adopts the last opened world once, at frame (0, 0)', () => {
    withTempDir((dir) => {
      const treePath = join(dir, 'we.tree')
      writeFileSync(treePath, 'tapestry\n', 'utf-8')
      const lastOpened = writeLastOpened(dir, treePath)
      const settings = new SettingsStore(dir)

      expect(settings.migrateLastOpened(lastOpened)).toBe(true)
      expect(settings.read().trees).toEqual([
        { path: treePath, kind: 'native', frame: { x: 0, y: 0 } },
      ])

      // Second call is a no-op: a non-empty `trees` means it already ran, so
      // no flag is needed and a later close cannot resurrect the old world.
      expect(settings.migrateLastOpened(lastOpened)).toBe(false)
      expect(settings.read().trees).toHaveLength(1)
    })
  })

  it('migrates nothing when there is no last-opened file', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)

      expect(settings.migrateLastOpened(join(dir, 'last-opened.json'))).toBe(false)
      expect(settings.read().trees).toEqual([])
    })
  })

  it('migrates nothing when the recorded file no longer exists', () => {
    withTempDir((dir) => {
      const lastOpened = writeLastOpened(dir, join(dir, 'gone.tree'))
      const settings = new SettingsStore(dir)

      expect(settings.migrateLastOpened(lastOpened)).toBe(false)
      expect(settings.read().trees).toEqual([])
    })
  })

  it('migrates nothing from a corrupted or unsafe last-opened file', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      const lastOpened = join(dir, 'last-opened.json')

      writeFileSync(lastOpened, '{', 'utf-8')
      expect(settings.migrateLastOpened(lastOpened)).toBe(false)

      // A relative path, and a path climbing out of its directory, are both
      // refused by the same rule the IPC validator uses.
      writeFileSync(lastOpened, JSON.stringify({ path: 'relative/we.tree' }), 'utf-8')
      expect(settings.migrateLastOpened(lastOpened)).toBe(false)

      writeFileSync(lastOpened, JSON.stringify({ path: '/tmp/../etc/we.tree' }), 'utf-8')
      expect(settings.migrateLastOpened(lastOpened)).toBe(false)

      expect(settings.read().trees).toEqual([])
    })
  })
})

describe('SettingsStore passthrough (2.6 D-10)', () => {
  /**
   * A file this build does not fully understand: a newer version, a pointer
   * key a later plan adds, 2.2's agentHttp, an arbitrary future key, and a
   * `trees` list holding one malformed entry (a relative path).
   */
  const fixture = {
    version: 2,
    userName: 'old',
    agentsEnabled: true,
    tapestry: { path: '/tmp/passthrough/Tapestry.tree' },
    agentHttp: { enabled: false, port: 47831 },
    trees: [
      { path: '/tmp/passthrough/ok.tree', kind: 'native', frame: { x: 12.5, y: -4 } },
      { path: 'relative/bad.tree', kind: 'native', frame: { x: 0, y: 0 } },
    ],
    futureKey: ['a', 1, { nested: true }],
  }

  function writeFixture(settings: SettingsStore, content: unknown): void {
    writeFileSync(settings.path, `${JSON.stringify(content, null, 2)}\n`, 'utf-8')
  }

  function readFile(settings: SettingsStore): Record<string, unknown> {
    return JSON.parse(readFileSync(settings.path, 'utf-8')) as Record<string, unknown>
  }

  it('keeps unknown keys, the version and the raw trees list through setUserName', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, fixture)

      settings.setUserName('kaelen')

      const written = readFile(settings)
      expect(written.version).toBe(2)
      expect(written.userName).toBe('kaelen')
      expect(written.tapestry).toEqual(fixture.tapestry)
      expect(written.agentHttp).toEqual(fixture.agentHttp)
      expect(written.futureKey).toEqual(fixture.futureKey)
      // The malformed entry is still there: the old list is a backup, never cleaned.
      expect(written.trees).toEqual(fixture.trees)
      // Unknown keys keep their place in the file.
      expect(Object.keys(written)).toEqual(Object.keys(fixture))
    })
  })

  it('keeps the same keys through the agents switch update', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, fixture)

      settings.update((s) => ({ ...s, agentsEnabled: false }))

      const written = readFile(settings)
      expect(written.agentsEnabled).toBe(false)
      expect(written.version).toBe(2)
      expect(written.userName).toBe('old')
      expect(written.tapestry).toEqual(fixture.tapestry)
      expect(written.agentHttp).toEqual(fixture.agentHttp)
      expect(written.futureKey).toEqual(fixture.futureKey)
      expect(written.trees).toEqual(fixture.trees)
    })
  })

  it('reads the version from the file and writes a higher one back as found', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, { ...fixture, version: 7 })

      expect(settings.read().version).toBe(7)
      settings.setUserName('kaelen')

      expect(readFile(settings).version).toBe(7)
    })
  })

  it('never lowers a valid version even when a mutator asks for it', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, { ...fixture, version: 3 })

      settings.update((s) => ({ ...s, version: 1 }))

      expect(readFile(settings).version).toBe(3)
    })
  })

  it('leaves a version 1 file at version 1', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, { version: 1, userName: null, agentsEnabled: true, trees: [] })

      settings.setUserName('kaelen')

      expect(readFile(settings).version).toBe(1)
    })
  })

  it('reads an invalid version as 1', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, { ...fixture, version: 'two' })

      expect(settings.read().version).toBe(1)
    })
  })

  it('writes the trees list byte for byte when a write does not touch it', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, fixture)
      const treesBefore = JSON.stringify(readFile(settings).trees)

      settings.setUserName('kaelen')
      settings.update((s) => ({ ...s, agentsEnabled: false }))

      expect(JSON.stringify(readFile(settings).trees)).toBe(treesBefore)
    })
  })

  it('counts the malformed legacy entries it skips', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, fixture)

      expect(settings.readLegacyTrees()).toEqual({
        trees: [{ path: '/tmp/passthrough/ok.tree', kind: 'native', frame: { x: 12.5, y: -4 } }],
        skipped: 1,
      })
    })
  })

  it('reports nothing skipped when trees is absent or not a list', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      expect(settings.readLegacyTrees()).toEqual({ trees: [], skipped: 0 })

      writeFixture(settings, { version: 1, trees: 'nonsense' })
      expect(settings.readLegacyTrees()).toEqual({ trees: [], skipped: 0 })
    })
  })

  it('writes the full known shape when there is no file yet', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)

      settings.setUserName('kaelen')

      expect(readFile(settings)).toEqual({
        version: 1,
        userName: 'kaelen',
        agentsEnabled: true,
        trees: [],
      })
    })
  })
})

describe('suggestUserName', () => {
  it('takes the first word of the full name', () => {
    expect(suggestUserName('Kaelen Cook', 'kaelencook')).toBe('kaelen')
  })

  it('falls back to the account name', () => {
    expect(suggestUserName(null, 'kaelencook')).toBe('kaelencook')
  })

  it('falls back to "me" when neither can be cleaned into a name', () => {
    expect(suggestUserName('', '!!!')).toBe('me')
  })

  it('lowercases and strips punctuation', () => {
    expect(suggestUserName('Ada.Lovelace Byron', 'ada')).toBe('adalovelace')
  })
})
