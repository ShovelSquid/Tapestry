/**
 * Reading a vault folder safely.
 *
 * Everything here treats the vault as hostile input, because it genuinely is
 * shared ground: Obsidian, Obsidian Sync, other Claude sessions and Kaelen all
 * write into the same folder while Tapestry is reading it. So this module
 * never follows a symlink (T-02.2-33), never reads an unbounded file
 * (T-02.2-34), and never transcodes bytes it cannot decode — a file that will
 * not fit the `.tree` limits is described in words rather than mangled into
 * something that would then be recorded as what the file "says".
 *
 * Since 02.7 the walking, bounded reading and decoding live in
 * `../mirror/fs.ts`, shared with workspaces; this module keeps the vault's own
 * names and its Markdown classification on top.
 */

import { basename, join, resolve } from 'path'
import {
  decodeText,
  MAX_MIRROR_READ_BYTES,
  readBoundedBytes,
  walkFolder,
  type BoundedBytes,
  type TextDecode,
} from '../mirror/fs'

// ---------------------------------------------------------------------------
// Where a vault's own files live (D-13)
// ---------------------------------------------------------------------------

export interface VaultTreeFiles {
  /** The vault folder's own name, which is the tree's display name. */
  name: string
  /** `<root>/<name>.tree` — the history travels with the vault (D-13). */
  treePath: string
  /** `<root>/<name>.signin.log` — the agent sign-in log (D-09, Plan 12). */
  signinLogPath: string
  /**
   * The world token written on the header's `world` line.
   *
   * The header grammar is `world <token>` and a token holds no space, so
   * `House Party` is refused outright (research Pitfall 1). It is sanitised
   * rather than rejected, and the frame keeps the folder's real name — the
   * token is an identifier, the name is what a person reads.
   */
  worldName: string
}

export function vaultTreeFiles(root: string): VaultTreeFiles {
  const name = basename(resolve(root))
  return {
    name,
    treePath: join(root, `${name}.tree`),
    signinLogPath: join(root, `${name}.signin.log`),
    worldName: name.replace(/[^A-Za-z0-9_-]/g, '_'),
  }
}

// ---------------------------------------------------------------------------
// What the bridge does not look at
// ---------------------------------------------------------------------------

/**
 * Paths the mirror ignores, checked segment by segment.
 *
 * Dot-segments cover `.obsidian`, `.trash`, every dotfile and the
 * `.*.tapestry-tmp` files an atomic write leaves behind mid-flight. The tree
 * and the sign-in log are excluded because they are Tapestry's own record of
 * the vault: mirroring them would record the record.
 */
export function isIgnoredVaultPath(rel: string): boolean {
  for (const segment of rel.split('/')) {
    if (segment.length === 0) continue
    if (segment.startsWith('.')) return true
    if (/\.tree$/i.test(segment)) return true
    if (/\.signin\.log$/i.test(segment)) return true
    if (/\.tree\.torn-/i.test(segment)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

export interface VaultEntry {
  /** Vault-relative, always with `/` separators. */
  rel: string
  kind: 'dir' | 'md' | 'file' | 'symlink'
  size: number
  /** Inode, used to pair a rename while the app is running (D-24, Plan 08). */
  ino: number
}

/**
 * Every path in the vault, sorted, with symlinks recorded but never followed
 * (T-02.2-33). A file whose name ends in `.md` (any case) is an `md` entry.
 */
export async function walkVault(root: string): Promise<VaultEntry[]> {
  const entries = await walkFolder(root, isIgnoredVaultPath)
  return entries.map((entry): VaultEntry => ({
    rel: entry.rel,
    kind: entry.kind === 'file' && /\.md$/i.test(entry.rel) ? 'md' : entry.kind,
    size: entry.size,
    ino: entry.ino,
  }))
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type VaultBytes = BoundedBytes

/** 16 MiB. A single `.md` larger than this is described, never loaded. */
export const MAX_VAULT_READ_BYTES = MAX_MIRROR_READ_BYTES

/** Read one vault file and hash it, bounded before allocation (T-02.2-34). */
export const readVaultBytes: (root: string, rel: string, maxBytes?: number) => VaultBytes =
  readBoundedBytes

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export type MarkdownDecode = TextDecode

/** Decode a `.md` file's bytes, or say why it cannot be one note's text. */
export const decodeMarkdown: (bytes: Buffer) => MarkdownDecode = decodeText
