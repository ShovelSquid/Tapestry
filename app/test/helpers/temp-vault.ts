/**
 * Temp-vault helper — the only vault any automated test is allowed to open.
 *
 * `app/test/fixtures/vault-sample` is synthetic: every file in it was written
 * for this repository and reproduces a shape the mirror has to handle (no
 * trailing newline, uniform CRLF, a bare `TEXT` line, frontmatter, a tag inside
 * a fence, an alias, an embed, an unresolved link, a duplicated basename).
 *
 * It is deliberately NOT a copy of `~/House Party`. D-19 names House Party as
 * the vault to build and test *against*; it does not authorise committing
 * Kaelen's personal creative writing into this repository's history. The real
 * vault is opened only in end-of-phase manual verification, with Kaelen
 * present, and `assertNotRealData` guards every path this helper produces.
 */

import { cpSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { makeTempDir } from './temp-tree'
import { assertNotRealData } from './real-data-guard'

/** Where the fixtures live, relative to this file. */
const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures')

/**
 * The folder name every copy is given.
 *
 * The space is the point: `world <token>` admits no space, so every test that
 * opens this vault exercises the sanitisation path (`Vault Sample` →
 * `Vault_Sample`) rather than a name that would have worked either way.
 */
export const TEMP_VAULT_FOLDER_NAME = 'Vault Sample'

export interface TempVault {
  /** The copied vault folder — `<tmp>/Vault Sample`. */
  root: string
  /** The temp directory holding it. */
  dir: string
  cleanup(): void
}

/**
 * Copy a fixture vault into a fresh temp directory and return its root.
 *
 * Tests mutate the copy freely; the fixture on disk is never touched.
 */
export function makeTempVault(fixture = 'vault-sample'): TempVault {
  const dir = makeTempDir('vault')
  const root = join(dir, TEMP_VAULT_FOLDER_NAME)

  // Belt and braces: makeTempDir already asserted, and the vault root is the
  // path everything else is resolved against.
  assertNotRealData(root)

  cpSync(join(FIXTURES_DIR, fixture), root, { recursive: true })

  return {
    root,
    dir,
    cleanup(): void {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
