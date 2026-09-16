/**
 * A synthetic vault of awkward shapes, built in the OS temp directory.
 *
 * `vault-sample` is the readable fixture a person can open and understand.
 * This one is the opposite: every file exists to make some part of the mirror
 * prove itself — bytes that are not UTF-8, a file with no trailing newline, a
 * line reading exactly `TEXT` (which forces the encoder onto a new block
 * delimiter), a duplicated basename, an embed of a real image, and a fenced
 * block whose contents must be ignored.
 *
 * It is written byte by byte here rather than committed as files, because
 * these shapes are exactly what a checkout with line-ending normalisation
 * would quietly rewrite. Building them at runtime means the test asserts what
 * this code wrote, not what git decided to hand back.
 *
 * Like every vault helper, it builds only under `os.tmpdir()` and runs every
 * path through `assertNotRealData`, so it can never reach `~/House Party`.
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeTempDir } from './temp-tree'
import { assertNotRealData } from './real-data-guard'

/** The space is deliberate: `world <token>` admits none, so it is sanitised. */
export const EDGE_VAULT_FOLDER_NAME = 'Edge Vault'

export interface EdgeVault {
  /** The vault folder — `<tmp>/Edge Vault`. */
  root: string
  /** The temp directory holding it. */
  dir: string
  cleanup(): void
}

/** Eight bytes that are not a real PNG, and do not need to be (D-29). */
export const EDGE_VAULT_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

/** `0xff 0xfe` is a BOM for a encoding this mirror refuses to transcode. */
export const EDGE_VAULT_BAD_BYTES = Buffer.from([0xff, 0xfe])

/** Every text file, exactly as written. Exported so tests assert against it. */
export const EDGE_VAULT_TEXT: Record<string, string> = {
  'crlf.md': 'line one\r\n[[b]]\r\n',
  'no-lf.md': 'ends here [[b]]',
  'text-line.md': 'before\nTEXT\nafter [[b]]\n',
  'b.md': 'I am b.\n',
  'embeds.md': '![[map.png]]\n',
  'A/dup.md': 'A duplicate living in A.\n',
  'B/dup.md': 'A duplicate living in B.\n',
  'uses-dup.md': '[[dup]]\n',
  'fence.md': '```\n[[ghost]]\n```\n`#nottag` #real\n',
  'front.md': '---\ntitle: Front\nwritten by: me\ntags: [x, y]\n---\nbody [[b]]\n',
}

/**
 * Build the edge-case vault and return its root.
 *
 * Text files are written with an explicit utf-8 encoding and no newline
 * translation, so `crlf.md` really does hold CR bytes and `no-lf.md` really
 * does end without a newline.
 */
export function makeEdgeVault(): EdgeVault {
  const dir = makeTempDir('edge-vault')
  const root = join(dir, EDGE_VAULT_FOLDER_NAME)
  assertNotRealData(root)

  mkdirSync(root, { recursive: true })
  mkdirSync(join(root, 'A'), { recursive: true })
  mkdirSync(join(root, 'B'), { recursive: true })

  for (const [rel, text] of Object.entries(EDGE_VAULT_TEXT)) {
    writeFileSync(join(root, ...rel.split('/')), Buffer.from(text, 'utf-8'))
  }

  writeFileSync(join(root, 'bad.md'), EDGE_VAULT_BAD_BYTES)
  writeFileSync(join(root, 'map.png'), EDGE_VAULT_PNG_BYTES)

  return {
    root,
    dir,
    cleanup(): void {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
