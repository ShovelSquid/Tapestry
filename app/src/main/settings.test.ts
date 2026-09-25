/**
 * settings.json is a plain file the user can edit by hand, so every read is
 * treated as untrusted input. These tests pin the two things that matter:
 * a name that survives a restart, and a malformed file that costs nothing.
 *
 * The user name ends up inside an `actor` line, which is why an invalid one
 * must never round-trip (threat T-02.2-03).
 */

import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { SettingsStore, SettingsUnreadableError, suggestUserName } from './settings'
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

  it('writes the known shape without a trees key when there is no file yet', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)

      settings.setUserName('kaelen')

      // A file with no `trees` key keeps none: this build never writes the
      // list (2.6 D-10), so a fresh file does not grow one.
      expect(readFile(settings)).toEqual({
        version: 1,
        userName: 'kaelen',
        agentsEnabled: true,
      })
    })
  })

  it('leaves trees deep-equal even when a mutator returns a different trees array (D-10)', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, fixture)

      settings.update((s) => ({
        ...s,
        trees: [{ path: '/tmp/passthrough/other.tree', kind: 'native', frame: { x: 9, y: 9 } }],
      }))
      expect(readFile(settings).trees).toEqual(fixture.trees)

      settings.update((s) => ({ ...s, trees: [] }))
      expect(readFile(settings).trees).toEqual(fixture.trees)
    })
  })

  it('does not add a trees key when a mutator returns one for a file without it', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, { version: 2, userName: 'kaelen', agentsEnabled: true })

      settings.update((s) => ({
        ...s,
        trees: [{ path: '/tmp/passthrough/other.tree', kind: 'native', frame: { x: 9, y: 9 } }],
      }))

      expect(Object.prototype.hasOwnProperty.call(readFile(settings), 'trees')).toBe(false)
    })
  })

  it('has no tree writers left (D-10, answer 2.2)', () => {
    const proto = SettingsStore.prototype as unknown as Record<string, unknown>
    for (const name of ['addTree', 'setTreeFrame', 'removeTree', 'migrateLastOpened']) {
      expect(proto[name]).toBeUndefined()
    }
  })
})

describe('SettingsStore Tapestry pointer (2.6 D-02)', () => {
  const v1 = {
    version: 1,
    userName: 'kaelen',
    agentsEnabled: true,
    trees: [
      { path: '/tmp/tapestry-fixture/bega.tree', kind: 'native', frame: { x: -245.5, y: -65.25 } },
      { path: 'relative.tree', kind: 'native', frame: { x: 1, y: 2 } },
    ],
  }

  function writeFixture(settings: SettingsStore, extra: Record<string, unknown> = {}): void {
    writeFileSync(settings.path, JSON.stringify({ ...v1, ...extra }, null, 2), 'utf-8')
  }

  it('reads null when there is no pointer', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings)
      expect(settings.getTapestryPointer()).toBeNull()
    })
  })

  it.each([
    ['a relative path', { path: 'Tapestry/Tapestry.tree' }],
    ['a .. segment', { path: '/tmp/a/../Tapestry.tree' }],
    ['a path that is not a .tree', { path: '/tmp/Tapestry.json' }],
    ['a non-object pointer', '/tmp/Tapestry.tree'],
    ['an array pointer', ['/tmp/Tapestry.tree']],
    ['a non-string path', { path: 42 }],
  ])('reads %s as no pointer', (_label, pointer) => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, { tapestry: pointer })
      expect(settings.getTapestryPointer()).toBeNull()
    })
  })

  it('writes the pointer and version 2, leaving trees exactly as they were', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, { futureKey: { a: 1 } })
      const home = join(dir, 'space', 'Tapestry.tree')

      settings.setTapestryPointer(home)

      const written = JSON.parse(readFileSync(settings.path, 'utf-8'))
      expect(written.version).toBe(2)
      expect(written.tapestry).toEqual({ path: home })
      expect(written.trees).toEqual(v1.trees)
      expect(written.futureKey).toEqual({ a: 1 })
      expect(written.userName).toBe('kaelen')
      expect(settings.getTapestryPointer()).toBe(home)
    })
  })

  it('never lowers a newer version when writing the pointer (case I)', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings, { version: 5 })
      settings.setTapestryPointer(join(dir, 'Tapestry.tree'))
      expect(JSON.parse(readFileSync(settings.path, 'utf-8')).version).toBe(5)
    })
  })

  it('keeps the pointer through a later setUserName', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFixture(settings)
      const home = join(dir, 'Tapestry.tree')
      settings.setTapestryPointer(home)

      settings.setUserName('sam')

      const written = JSON.parse(readFileSync(settings.path, 'utf-8'))
      expect(written.tapestry).toEqual({ path: home })
      expect(written.version).toBe(2)
      expect(written.trees).toEqual(v1.trees)
      expect(settings.getTapestryPointer()).toBe(home)
    })
  })

  it.each(['relative/Tapestry.tree', '/tmp/a/../Tapestry.tree', '/tmp/Tapestry.json', ''])(
    'refuses %j and leaves the file bytes unchanged',
    (bad) => {
      withTempDir((dir) => {
        const settings = new SettingsStore(dir)
        writeFixture(settings)
        const before = readFileSync(settings.path, 'utf-8')

        expect(() => settings.setTapestryPointer(bad)).toThrow('Invalid Tapestry tree path')

        expect(readFileSync(settings.path, 'utf-8')).toBe(before)
      })
    },
  )
})

describe('SettingsStore with an unreadable file (2.6 gap 1, CR-01)', () => {
  const TRAILING_COMMA = '{\n  "userName": "kaelen",\n  "trees": [],\n}\n'
  const POINTER = '/Users/you/Documents/Tapestry/Tapestry.tree'

  it('a trailing comma: every writer throws, the bytes stay, and no temp file is left', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFileSync(settings.path, TRAILING_COMMA, 'utf-8')
      const before = readFileSync(settings.path)

      expect(() => settings.assertReadable()).toThrow(SettingsUnreadableError)
      expect(() => settings.setTapestryPointer(POINTER)).toThrow(SettingsUnreadableError)
      expect(readFileSync(settings.path).equals(before)).toBe(true)
      expect(() => settings.setUserName('someone')).toThrow(SettingsUnreadableError)
      expect(readFileSync(settings.path).equals(before)).toBe(true)
      expect(() =>
        settings.update((current) => ({ ...current, agentsEnabled: false })),
      ).toThrow(SettingsUnreadableError)
      expect(readFileSync(settings.path).equals(before)).toBe(true)
      expect(existsSync(`${settings.path}.tmp`)).toBe(false)
    })
  })

  it('a trailing comma still reads as defaults and as no pointer', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFileSync(settings.path, TRAILING_COMMA, 'utf-8')

      expect(settings.read().userName).toBeNull()
      expect(settings.read().agentsEnabled).toBe(true)
      expect(settings.getTapestryPointer()).toBeNull()
      expect(settings.readLegacyTrees()).toEqual({ trees: [], skipped: 0 })
    })
  })

  it('names the file and the reason, and says it was left untouched', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFileSync(settings.path, TRAILING_COMMA, 'utf-8')

      let caught: unknown
      try {
        settings.setTapestryPointer(POINTER)
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(SettingsUnreadableError)
      const error = caught as SettingsUnreadableError
      expect(error.name).toBe('SettingsUnreadableError')
      expect(error.path).toBe(settings.path)
      expect(error.detail.length).toBeGreaterThan(0)
      expect(error.message).toBe(
        `${settings.path} could not be read, so it was left untouched: ${error.detail}`,
      )
    })
  })

  it.each([
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"text"'],
    ['a number', '42'],
  ])('%s is not a JSON object, and the pointer write leaves it byte-identical', (_label, text) => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFileSync(settings.path, text, 'utf-8')
      const before = readFileSync(settings.path)

      expect(() => settings.assertReadable()).toThrow('it is not a JSON object')
      expect(() => settings.setTapestryPointer(POINTER)).toThrow(SettingsUnreadableError)
      expect(() => settings.setUserName('someone')).toThrow(SettingsUnreadableError)
      expect(readFileSync(settings.path).equals(before)).toBe(true)
      expect(existsSync(`${settings.path}.tmp`)).toBe(false)
    })
  })

  it('a directory at the path cannot be read, so the pointer write throws and the directory stays', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      mkdirSync(settings.path)

      expect(() => settings.assertReadable()).toThrow(SettingsUnreadableError)
      expect(() => settings.setTapestryPointer(POINTER)).toThrow(SettingsUnreadableError)
      expect(statSync(settings.path).isDirectory()).toBe(true)
      expect(existsSync(`${settings.path}.tmp`)).toBe(false)
    })
  })

  it.each([
    ['empty', ''],
    ['whitespace-only', '  \n\t\n'],
  ])('an %s file counts as missing: the pointer write gives version 2 and the pointer', (_label, text) => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFileSync(settings.path, text, 'utf-8')

      expect(() => settings.assertReadable()).not.toThrow()
      settings.setTapestryPointer(POINTER)

      const written = JSON.parse(readFileSync(settings.path, 'utf-8'))
      expect(written.version).toBe(2)
      expect(settings.getTapestryPointer()).toBe(POINTER)
    })
  })

  it('a missing file behaves as before: the pointer write creates it with version 2', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)

      expect(existsSync(settings.path)).toBe(false)
      expect(() => settings.assertReadable()).not.toThrow()
      settings.setTapestryPointer(POINTER)

      const written = JSON.parse(readFileSync(settings.path, 'utf-8'))
      expect(written.version).toBe(2)
      expect(settings.getTapestryPointer()).toBe(POINTER)
    })
  })
})

describe('SettingsStore workspace trees (02.7)', () => {
  it('reads a workspace entry with its workspaceRoot, and drops one without a safe root', () => {
    withTempDir((dir) => {
      const settings = new SettingsStore(dir)
      writeFileSync(
        settings.path,
        JSON.stringify({
          version: 1,
          userName: 'kaelen',
          agentsEnabled: true,
          trees: [
            {
              path: '/tmp/app/workspaces/windows-0123abcd.tree',
              kind: 'workspace',
              workspaceRoot: '/tmp/windows',
              frame: { x: 3, y: 4 },
            },
            { path: '/tmp/app/workspaces/a.tree', kind: 'workspace', frame: { x: 0, y: 0 } },
            {
              path: '/tmp/app/workspaces/b.tree',
              kind: 'workspace',
              workspaceRoot: 'relative/windows',
              frame: { x: 0, y: 0 },
            },
          ],
        }),
        'utf-8',
      )

      expect(settings.read().trees).toEqual([
        {
          path: '/tmp/app/workspaces/windows-0123abcd.tree',
          kind: 'workspace',
          workspaceRoot: '/tmp/windows',
          frame: { x: 3, y: 4 },
        },
      ])
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
