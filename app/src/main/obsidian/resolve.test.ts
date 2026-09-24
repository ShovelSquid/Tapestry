/**
 * Which note a link means, and when Tapestry refuses to decide.
 *
 * The ambiguous case is the one that matters: two notes named `dup.md` in
 * different folders must produce neither connection, because Obsidian's own
 * tie-break is undocumented [research A4] and a guessed connection is a claim
 * the file never made.
 */

import { describe, expect, it } from 'vitest'
import { buildVaultIndex, resolveLink } from './resolve'
import type { VaultEntry } from './vault-fs'

function entry(rel: string, kind: VaultEntry['kind'] = 'md'): VaultEntry {
  return { rel, kind, size: 0, ino: 0 }
}

const INDEX = buildVaultIndex([
  entry('Characters', 'dir'),
  entry('Concepts', 'dir'),
  entry('Characters/Sable.md'),
  entry('Characters/Rune.md'),
  entry('Characters/dup.md'),
  entry('Concepts/dup.md'),
  entry('Welcome.md'),
  entry('map.png', 'file'),
])

describe('resolveLink', () => {
  it('matches a basename case-insensitively', () => {
    expect(resolveLink('sable', INDEX)).toEqual({
      kind: 'resolved',
      rel: 'Characters/Sable.md',
    })
    expect(resolveLink('SABLE', INDEX)).toEqual({
      kind: 'resolved',
      rel: 'Characters/Sable.md',
    })
  })

  it('matches a vault-relative path with or without .md', () => {
    expect(resolveLink('Characters/Sable', INDEX)).toEqual({
      kind: 'resolved',
      rel: 'Characters/Sable.md',
    })
    expect(resolveLink('characters/sable.md', INDEX)).toEqual({
      kind: 'resolved',
      rel: 'Characters/Sable.md',
    })
  })

  it('reports a link to a note that does not exist as unresolved', () => {
    expect(resolveLink('create a link', INDEX)).toEqual({ kind: 'unresolved' })
  })

  it('refuses to choose between two notes sharing a basename', () => {
    expect(resolveLink('dup', INDEX)).toEqual({
      kind: 'ambiguous',
      candidates: ['Characters/dup.md', 'Concepts/dup.md'],
    })
  })

  it('resolves the ambiguity when the link names the folder', () => {
    expect(resolveLink('Concepts/dup', INDEX)).toEqual({
      kind: 'resolved',
      rel: 'Concepts/dup.md',
    })
  })

  it('finds an attachment only when the link carries its extension', () => {
    expect(resolveLink('map.png', INDEX)).toEqual({ kind: 'resolved', rel: 'map.png' })
    expect(resolveLink('map', INDEX)).toEqual({ kind: 'unresolved' })
  })

  it('never turns link text into a filesystem path', () => {
    // T-02.2-38: resolution is a lookup in the walked index, so a traversal
    // attempt simply names nothing.
    expect(resolveLink('../../etc/passwd', INDEX)).toEqual({ kind: 'unresolved' })
    expect(resolveLink('', INDEX)).toEqual({ kind: 'unresolved' })
  })
})
