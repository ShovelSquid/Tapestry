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
