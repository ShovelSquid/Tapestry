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
import { KernelBridge, type EdgeData, type NodeData } from '../kernel-bridge'
import { TreeRegistry } from '../trees/registry'
import { VaultService } from './vault-service'
import { decodeMarkdown, isIgnoredVaultPath, vaultTreeFiles } from './vault-fs'
import {
  EMBED_LABEL,
  MD_AMBIGUOUS,
  MD_BYTES,
  MD_EXT,
  MD_FRONTMATTER,
  MD_LINE,
  MD_LINK,
  MD_PATH,
  MD_SHA256,
  MD_TAGS,
  MD_TEXT,
  MD_UNREADABLE,
  VAULT_FILE_TYPE,
  VAULT_FOLDER_TYPE,
  VAULT_NOTE_TYPE,
  VAULT_PLACEHOLDER_TYPE,
  WIKILINK_LABEL,
} from './shapes'
import { makeTempVault, type TempVault } from '../../../test/helpers/temp-vault'
import { EDGE_VAULT_TEXT, makeEdgeVault, type EdgeVault } from '../../../test/helpers/edge-vault'

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

// ---------------------------------------------------------------------------
// What the files say about each other (D-29, D-31, D-33, D-34)
// ---------------------------------------------------------------------------

/** The node an edge points at, by id. */
function nodeById(nodes: NodeData[], id: string): NodeData | undefined {
  return nodes.find((node) => node.id === id)
}

/** Every wikilink or embed edge leaving the note at `rel`. */
function edgesFrom(nodes: NodeData[], edges: EdgeData[], rel: string): EdgeData[] {
  const from = nodeForPath(nodes, rel)
  if (!from) return []
  return edges.filter(
    (edge) =>
      edge.from === from.id && (edge.label === WIKILINK_LABEL || edge.label === EMBED_LABEL),
  )
}

function placeholderFor(nodes: NodeData[], link: string): NodeData | undefined {
  return nodes.find(
    (node) =>
      node.type === VAULT_PLACEHOLDER_TYPE &&
      (propString(node, MD_LINK) ?? '').toLowerCase() === link.toLowerCase(),
  )
}

describe('vault derivation', () => {
  let vault: TempVault | null = null
  let edge: EdgeVault | null = null
  let registry: TreeRegistry | null = null

  afterEach(() => {
    registry?.closeAll()
    registry = null
    vault?.cleanup()
    vault = null
    edge?.cleanup()
    edge = null
  })

  it('records links as their literal lines, with embeds, tags and frontmatter', async () => {
    vault = makeTempVault()
    registry = new TreeRegistry()
    const service = new VaultService(registry)

    const tree = await service.addVault(vault.root)
    const bridge = registry.get(tree.id)!.bridge
    const nodes = bridge.getNodes()
    const edges = bridge.getEdges()

    // --- D-31: the label is the line, not a paraphrase ---------------------
    const fromWelcome = edgesFrom(nodes, edges, 'Welcome.md')
    const runeEdge = fromWelcome.find(
      (e) => propString(nodeById(nodes, e.to)!, MD_PATH) === 'Characters/Rune.md',
    )
    expect(runeEdge).toBeDefined()
    expect(runeEdge!.props[MD_LINE]?.value).toBe('Best friends with [[Rune]]')

    // Every literal line recorded on an edge really is a line of its file.
    for (const e of edges) {
      if (e.label !== WIKILINK_LABEL && e.label !== EMBED_LABEL) continue
      const source = nodeById(nodes, e.from)!
      const rel = propString(source, MD_PATH)!
      const fileLines = readFileSync(absOf(vault!.root, rel), 'utf-8')
        .split('\n')
        .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
      const recorded = String(e.props[MD_LINE]?.value ?? '')
      expect(fileLines, `${rel} contains the line recorded on its edge`).toContain(recorded)
    }

    // --- D-34: a link to a note that does not exist ------------------------
    const missing = placeholderFor(nodes, 'create a link')
    expect(missing, 'placeholder for [[create a link]]').toBeDefined()
    expect(missing!.props[MD_AMBIGUOUS]).toBeUndefined()
    expect(
      fromWelcome.some((e) => e.to === missing!.id),
      'Welcome.md is connected to the placeholder',
    ).toBe(true)

    // --- D-34: a link matching several notes is never guessed at -----------
    const ambiguous = placeholderFor(nodes, 'dup')
    expect(ambiguous, 'placeholder for the ambiguous [[dup]]').toBeDefined()
    expect(ambiguous!.props[MD_AMBIGUOUS]?.value).toBe(true)

    const dupTargets = ['Characters/dup.md', 'Concepts/dup.md']
    for (const candidate of dupTargets) {
      const target = nodeForPath(nodes, candidate)!
      expect(
        edges.some((e) => e.to === target.id),
        `nothing is connected to ${candidate}`,
      ).toBe(false)
    }
    // The UI-SPEC is explicit: never connected to either candidate. It is not
    // connected to its own placeholder either — only the placeholder shows.
    expect(fromWelcome.some((e) => e.to === ambiguous!.id)).toBe(false)

    // --- D-29: an embed points at the file note ----------------------------
    const png = nodeForPath(nodes, 'map.png')
    expect(png, 'map.png is a file note').toBeDefined()
    expect(png!.type).toBe(VAULT_FILE_TYPE)
    expect(png!.props[MD_EXT]?.value).toBe('png')
    expect(png!.props[MD_BYTES]?.value).toBe(readFileSync(absOf(vault.root, 'map.png')).length)
    expect(propString(png!, MD_SHA256)).toBe(sha256File(absOf(vault.root, 'map.png')))
    // The bytes themselves are described, never copied into the tree (D-29).
    expect(png!.props[MD_TEXT]).toBeUndefined()

    const embed = fromWelcome.find((e) => e.label === EMBED_LABEL)
    expect(embed, 'the embed edge').toBeDefined()
    expect(embed!.to).toBe(png!.id)

    // --- D-33: tags and frontmatter, without changing the file -------------
    const rune = nodeForPath(nodes, 'Characters/Rune.md')!
    expect(propString(rune, MD_TAGS)?.split(' ')).toContain('#character')

    const welcome = nodeForPath(nodes, 'Welcome.md')!
    const welcomeTags = propString(welcome, MD_TAGS)?.split(' ') ?? []
    expect(welcomeTags).toContain('#sample')
    // The tag inside the fenced block is not a tag.
    expect(welcomeTags).not.toContain('#notatag')

    expect(propString(welcome, MD_FRONTMATTER)).toBe(
      'title: Welcome\nwritten by: the sample\ntags: [sample, intro]',
    )
    expect(propString(welcome, 'md.fm.title')).toBe('Welcome')
    expect(propString(welcome, 'md.fm.tags')).toBe('sample, intro')
    // `written by` holds a space, so it is not a legal property key. It stays
    // in md.frontmatter rather than being renamed into something the file
    // never said.
    expect(welcome.props['md.fm.written by']).toBeUndefined()
    expect(welcome.props['md.fm.written_by']).toBeUndefined()
  })

  it('describes what it cannot read, and still mirrors the awkward bytes', async () => {
    edge = makeEdgeVault()
    registry = new TreeRegistry()
    const service = new VaultService(registry)

    const tree = await service.addVault(edge.root)
    const bridge = registry.get(tree.id)!.bridge
    const nodes = bridge.getNodes()
    const edges = bridge.getEdges()

    // --- An undecodable .md is described, never transcoded -----------------
    const bad = nodeForPath(nodes, 'bad.md')!
    expect(bad.type).toBe(VAULT_FILE_TYPE)
    expect(propString(bad, MD_UNREADABLE)).toBe('is not valid UTF-8')
    expect(bad.props[MD_TEXT]).toBeUndefined()

    // --- Byte shapes survive the round trip --------------------------------
    for (const rel of ['crlf.md', 'no-lf.md', 'text-line.md']) {
      const stored = Buffer.from(propString(nodeForPath(nodes, rel)!, MD_TEXT) ?? '', 'utf-8')
      expect(stored.equals(readFileSync(absOf(edge!.root, rel))), `${rel} byte-equal`).toBe(true)
      expect(stored.toString('utf-8')).toBe(EDGE_VAULT_TEXT[rel])
    }

    // The CR is a byte of the file, so md.text keeps it; md.line is what the
    // line says, so the edge does not.
    const crlfEdge = edgesFrom(nodes, edges, 'crlf.md')[0]
    expect(crlfEdge.props[MD_LINE]?.value).toBe('[[b]]')

    // --- An embed of a real attachment -------------------------------------
    const png = nodeForPath(nodes, 'map.png')!
    expect(png.props[MD_EXT]?.value).toBe('png')
    expect(png.props[MD_BYTES]?.value).toBe(8)
    expect(propString(png, MD_SHA256)).toBe(sha256File(absOf(edge.root, 'map.png')))
    expect(edgesFrom(nodes, edges, 'embeds.md')[0]?.to).toBe(png.id)

    // --- A duplicated basename is refused, not guessed ---------------------
    const ambiguous = placeholderFor(nodes, 'dup')!
    expect(ambiguous.props[MD_AMBIGUOUS]?.value).toBe(true)
    for (const candidate of ['A/dup.md', 'B/dup.md']) {
      const target = nodeForPath(nodes, candidate)!
      expect(edges.some((e) => e.to === target.id), `nothing connects to ${candidate}`).toBe(false)
    }
    expect(edgesFrom(nodes, edges, 'uses-dup.md')).toHaveLength(0)

    // --- A fenced link is not a link ---------------------------------------
    expect(placeholderFor(nodes, 'ghost')).toBeUndefined()
    const fence = nodeForPath(nodes, 'fence.md')!
    expect(propString(fence, MD_TAGS)).toBe('#real')

    // --- Frontmatter with a space in a key ---------------------------------
    const front = nodeForPath(nodes, 'front.md')!
    expect(propString(front, 'md.fm.title')).toBe('Front')
    expect(propString(front, 'md.fm.tags')).toBe('x, y')
    expect(propString(front, MD_FRONTMATTER)).toContain('written by: me')
  })

  it('replaces a placeholder in place once its note exists, and writes nothing twice', async () => {
    edge = makeEdgeVault()
    registry = new TreeRegistry()
    const service = new VaultService(registry)

    const tree = await service.addVault(edge.root)
    const treePath = join(edge.root, 'Edge Vault.tree')
    const afterImport = commitCount(readFileSync(treePath, 'utf-8'))

    // A catch-up over an unchanged vault still writes nothing, now that edges,
    // tags and frontmatter are in play: every desired edge must match the one
    // already recorded, or the journal would grow on every launch.
    await service.catchUp(tree.id)
    expect(commitCount(readFileSync(treePath, 'utf-8'))).toBe(afterImport)

    const bridge = registry.get(tree.id)!.bridge
    const ghost = placeholderFor(bridge.getNodes(), 'newcomer')
    expect(ghost).toBeUndefined()

    // Link to a note that does not exist, then create it.
    writeFileSync(absOf(edge.root, 'b.md'), 'I am b, and I know [[newcomer]].\n')
    await service.catchUp(tree.id)

    const placeholder = placeholderFor(bridge.getNodes(), 'newcomer')
    expect(placeholder, 'a placeholder appeared for the new link').toBeDefined()
    const where = {
      x: placeholder!.props['position.x']?.value,
      y: placeholder!.props['position.y']?.value,
    }

    writeFileSync(absOf(edge.root, 'newcomer.md'), 'I exist now.\n')
    await service.catchUp(tree.id)

    const after = bridge.getNodes()
    expect(placeholderFor(after, 'newcomer'), 'the placeholder is gone').toBeUndefined()

    const note = nodeForPath(after, 'newcomer.md')
    expect(note, 'the real note took its place').toBeDefined()
    // In place: typing into a placeholder must not make the card jump.
    expect(note!.props['position.x']?.value).toBe(where.x)
    expect(note!.props['position.y']?.value).toBe(where.y)

    // And the link now points at the note itself.
    const link = edgesFrom(after, bridge.getEdges(), 'b.md').find((e) => e.to === note!.id)
    expect(link).toBeDefined()
    expect(link!.props[MD_LINE]?.value).toBe('I am b, and I know [[newcomer]].')
  })
})
