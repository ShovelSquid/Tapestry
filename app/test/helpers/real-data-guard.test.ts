/**
 * The real-data guard is the mitigation that keeps the suite away from
 * Kaelen's actual notes (threat T-02.2-05), so it is tested directly rather
 * than only through the temp helpers that call it.
 *
 * These tests never create, read or write anything under the real roots —
 * they only ask the guard what it thinks of a path.
 */

import { describe, expect, it } from 'vitest'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { assertNotRealData, REAL_DATA_ROOTS } from './real-data-guard'
import { makeTempDir } from './temp-tree'
import { rmSync } from 'fs'

describe('assertNotRealData', () => {
  it('names the three real-data roots', () => {
    expect([...REAL_DATA_ROOTS]).toEqual([
      join(homedir(), 'House Party'),
      join(homedir(), 'Documents'),
      join(homedir(), 'Tapestry Tales'),
    ])
  })

  it('throws for each root itself', () => {
    for (const root of REAL_DATA_ROOTS) {
      expect(() => assertNotRealData(root)).toThrow('Refusing to touch real user data')
    }
  })

  it('throws for a path inside a root', () => {
    expect(() => assertNotRealData(join(homedir(), 'Documents', 'we.tree'))).toThrow(
      'Refusing to touch real user data',
    )
    expect(() =>
      assertNotRealData(join(homedir(), 'House Party', 'Characters', 'Rody.md')),
    ).toThrow('Refusing to touch real user data')
    expect(() => assertNotRealData(join(homedir(), 'Tapestry Tales', 'Home.md'))).toThrow(
      'Refusing to touch real user data',
    )
  })

  it('throws for a path that reaches a root through ".." segments', () => {
    const sneaky = join(homedir(), 'Documents', '..', 'Documents', 'we.tree')
    expect(() => assertNotRealData(sneaky)).toThrow('Refusing to touch real user data')
  })

  it('allows a temp directory', () => {
    const dir = makeTempDir('guard')
    try {
      expect(() => assertNotRealData(dir)).not.toThrow()
      expect(() => assertNotRealData(join(dir, 'guard.tree'))).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not mistake a sibling of a root for the root', () => {
    expect(() => assertNotRealData(join(homedir(), 'DocumentsOld'))).not.toThrow()
    expect(() => assertNotRealData(join(tmpdir(), 'House Party Copy'))).not.toThrow()
  })
})
