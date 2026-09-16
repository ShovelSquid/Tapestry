/**
 * The vault mirror, end to end (D-10, D-12, D-13, D-20, D-30).
 *
 * These tests open a **temp copy of the synthetic fixture** and nothing else.
 * `makeTempVault` runs every path through `assertNotRealData`, so nothing here
 * can reach `~/House Party`, `~/Documents/we.tree` or `~/Tapestry Tales` even
 * by accident. The real vault is opened only in end-of-phase manual
 * verification, with Kaelen present.
 *
 * The central claim is byte equality after a close and reopen: a mirror that is
 * almost right is not a record of the file, it is an opinion about it.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { KernelBridge, type NodeData } from '../kernel-bridge'
import { TreeRegistry } from '../trees/registry'
import { VaultService } from './vault-service'
import { decodeMarkdown, isIgnoredVaultPath, vaultTreeFiles } from './vault-fs'
import { MD_PATH, MD_SHA256, MD_TEXT, VAULT_FOLDER_TYPE, VAULT_NOTE_TYPE } from './shapes'
import { makeTempVault, type TempVault } from '../../../test/helpers/temp-vault'

/** Every `.md` file the fixture holds, by vault-relative path. */
const FIXTURE_NOTES = [
  'Characters/Rune.md',
  'Characters/Sable.md',
  'Characters/dup.md',
  'Concepts/dup.md',
  'Welcome.md',
  'crlf.md',
  'no-trailing-newline.md',
  'text-line.md',
]

const TREE_FILE_NAME = 'Vault Sample.tree'

function absOf(root: string, rel: string): string {
  return join(root, ...rel.split('/'))
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function propString(node: NodeData, key: string): string | null {
  const prop = node.props[key]
  return prop && typeof prop.value === 'string' ? prop.value : null
}

function nodeForPath(nodes: NodeData[], rel: string): NodeData | undefined {
  return nodes.find((node) => propString(node, MD_PATH) === rel)
}

/** How many commits the journal holds, counted from the file itself. */
function commitCount(treeText: string): number {
  return (treeText.match(/^@commit /gm) ?? []).length
}

// ---------------------------------------------------------------------------

describe('vault mirror', () => {
  let vault: TempVault | null = null
  let registry: TreeRegistry | null = null

  afterEach(() => {
    // The addon holds flock(LOCK_EX) for the life of an open world, so a leaked
    // bridge would make the next test fail on the lock rather than on its claim.
    registry?.closeAll()
    registry = null
    vault?.cleanup()
    vault = null
  })

  it('mirrors every Markdown file byte-exactly into a tree inside the vault', async () => {
    vault = makeTempVault()
    registry = new TreeRegistry()
    const service = new VaultService(registry)

    // What the vault said before Tapestry touched it.
    const hashesBefore = new Map(
      FIXTURE_NOTES.map((rel) => [rel, sha256File(absOf(vault!.root, rel))]),
    )

    await service.addVault(vault.root)

    const treePath = join(vault.root, TREE_FILE_NAME)
    expect(existsSync(treePath)).toBe(true)

    const treeText = readFileSync(treePath, 'utf-8')
    // The folder name holds a space and `world <token>` admits none, so this
    // line is the proof that the name was sanitised rather than refused.
    expect(treeText).toContain('\nworld Vault_Sample\n')
    expect(treeText).toContain('actor plugin obsidian.bridge')

    // Close everything and read the world back from disk: a mirror that is only
    // correct in memory has not proved anything about the file.
    registry.closeAll()

    const reopened = new KernelBridge()
    reopened.open(treePath)
    try {
      expect(reopened.status().kind).toBe('Ok')
      const nodes = reopened.getNodes()

      for (const rel of FIXTURE_NOTES) {
        const matches = nodes.filter(
          (node) => node.type === VAULT_NOTE_TYPE && propString(node, MD_PATH) === rel,
        )
        expect(matches, `one note for ${rel}`).toHaveLength(1)

        const abs = absOf(vault!.root, rel)
        const fileBytes = readFileSync(abs)
        const stored = Buffer.from(propString(matches[0], MD_TEXT) ?? '', 'utf-8')

        // Compared as bytes, not as strings: this is what proves crlf.md keeps
        // its CR bytes, no-trailing-newline.md gains no final newline, and
        // text-line.md keeps the bare TEXT line that forced a new delimiter.
        expect(stored.equals(fileBytes), `${rel} is byte-equal to its file`).toBe(true)
        expect(propString(matches[0], MD_SHA256), `${rel} hash`).toBe(sha256File(abs))
      }

      const folders = nodes
        .filter((node) => node.type === VAULT_FOLDER_TYPE)
        .map((node) => propString(node, MD_PATH))
        .sort()
      expect(folders).toEqual(['Characters', 'Concepts'])
    } finally {
      reopened.close()
    }

    // D-10's other half: reading a vault changes nothing in it.
    for (const [rel, hash] of hashesBefore) {
      expect(sha256File(absOf(vault.root, rel)), `${rel} was not written to`).toBe(hash)
    }
  })

  it('catches up a change made while it was closed, as one observed commit', async () => {
    vault = makeTempVault()
    registry = new TreeRegistry()
    const service = new VaultService(registry)

    const tree = await service.addVault(vault.root)
    const treePath = join(vault.root, TREE_FILE_NAME)
    const afterImport = commitCount(readFileSync(treePath, 'utf-8'))
    expect(afterImport).toBeGreaterThan(0)

    // An unchanged vault writes nothing at all. Without this, every launch
    // would append a commit saying the same thing as the one before it.
    await service.catchUp(tree.id)
    expect(commitCount(readFileSync(treePath, 'utf-8'))).toBe(afterImport)

    const runeRel = 'Characters/Rune.md'
    const runeText = 'Rune keeps the archive, and the night shift.\n'
    writeFileSync(absOf(vault.root, runeRel), runeText)

    await service.catchUp(tree.id)

    const treeText = readFileSync(treePath, 'utf-8')
    expect(commitCount(treeText)).toBe(afterImport + 1)
    expect(treeText).toContain(`message "observed change to ${runeRel}"`)

    const node = nodeForPath(registry.get(tree.id)!.bridge.getNodes(), runeRel)
    expect(node).toBeDefined()
    expect(propString(node!, MD_TEXT)).toBe(runeText)
    expect(propString(node!, MD_SHA256)).toBe(sha256File(absOf(vault.root, runeRel)))
  })

  it('names the tree after the folder and sanitises the world token', () => {
    const files = vaultTreeFiles('/tmp/somewhere/House Party')
    expect(files.name).toBe('House Party')
    expect(files.worldName).toBe('House_Party')
    expect(files.treePath).toBe('/tmp/somewhere/House Party/House Party.tree')
    expect(files.signinLogPath).toBe('/tmp/somewhere/House Party/House Party.signin.log')
  })

  it('ignores Tapestry’s own files and every dot-path in the vault', () => {
    expect(isIgnoredVaultPath('.obsidian/core-plugins.json')).toBe(true)
    expect(isIgnoredVaultPath('.trash/Old.md')).toBe(true)
    expect(isIgnoredVaultPath('Characters/.DS_Store')).toBe(true)
    expect(isIgnoredVaultPath('Vault Sample.tree')).toBe(true)
    expect(isIgnoredVaultPath('Vault Sample.signin.log')).toBe(true)
    expect(isIgnoredVaultPath('Vault Sample.tree.torn-2026-09-15T00-00-00Z')).toBe(true)

    expect(isIgnoredVaultPath('Welcome.md')).toBe(false)
    expect(isIgnoredVaultPath('Characters/Rune.md')).toBe(false)
    expect(isIgnoredVaultPath('map.png')).toBe(false)
  })

  it('refuses bytes it would have to change to store, rather than changing them', () => {
    expect(decodeMarkdown(Buffer.from('plain text\n', 'utf-8'))).toEqual({
      ok: true,
      text: 'plain text\n',
    })

    expect(decodeMarkdown(Buffer.from([0x61, 0x00, 0x62]))).toEqual({
      ok: false,
      reason: 'contains a NUL byte',
    })

    // A lone continuation byte: valid as bytes, not as UTF-8.
    expect(decodeMarkdown(Buffer.from([0x61, 0x80, 0x62]))).toEqual({
      ok: false,
      reason: 'is not valid UTF-8',
    })

    const longLine = Buffer.concat([
      Buffer.alloc(1024 * 1024 + 1, 0x61),
      Buffer.from('\n', 'utf-8'),
    ])
    expect(decodeMarkdown(longLine)).toEqual({
      ok: false,
      reason: 'has a line longer than 1 MiB',
    })
  })
})
