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
 */

import { createHash } from 'crypto'
import { lstatSync, readFileSync } from 'fs'
import { lstat, readdir } from 'fs/promises'
import { basename, join, resolve } from 'path'

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
 * Every path in the vault, sorted, with symlinks recorded but never followed.
 *
 * `lstat` rather than `stat` is the whole mitigation for T-02.2-33: a symlink
 * pointing at `~/.ssh` is a `symlink` entry the mirror will describe and refuse
 * to read, not a door out of the vault.
 */
export async function walkVault(root: string): Promise<VaultEntry[]> {
  const base = resolve(root)
  const out: VaultEntry[] = []

  async function visit(dirAbs: string, dirRel: string): Promise<void> {
    let names: string[]
    try {
      names = await readdir(dirAbs)
    } catch {
      // A folder that vanished or cannot be read mid-walk contributes nothing
      // rather than failing the whole catch-up.
      return
    }

    for (const name of names) {
      const rel = dirRel.length > 0 ? `${dirRel}/${name}` : name
      if (isIgnoredVaultPath(rel)) continue

      const abs = join(dirAbs, name)
      let stats
      try {
        stats = await lstat(abs)
      } catch {
        continue
      }

      if (stats.isSymbolicLink()) {
        out.push({ rel, kind: 'symlink', size: stats.size, ino: stats.ino })
        continue
      }
      if (stats.isDirectory()) {
        out.push({ rel, kind: 'dir', size: stats.size, ino: stats.ino })
        await visit(abs, rel)
        continue
      }
      if (stats.isFile()) {
        out.push({
          rel,
          kind: /\.md$/i.test(name) ? 'md' : 'file',
          size: stats.size,
          ino: stats.ino,
        })
      }
      // Anything else (a socket, a device node) is not vault content.
    }
  }

  await visit(base, '')
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return out
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type VaultBytes =
  | { bytes: Buffer; sha256: string }
  | { tooLarge: true; size: number }

/** 16 MiB. A single `.md` larger than this is described, never loaded. */
export const MAX_VAULT_READ_BYTES = 16 * 1024 * 1024

/**
 * Read one vault file and hash it.
 *
 * The size is checked with `lstat` before a byte is allocated, so a 4 GiB file
 * dropped into the vault costs a stat rather than the heap (T-02.2-34).
 */
export function readVaultBytes(
  root: string,
  rel: string,
  maxBytes: number = MAX_VAULT_READ_BYTES,
): VaultBytes {
  const abs = join(resolve(root), ...rel.split('/'))
  const stats = lstatSync(abs)
  if (stats.size > maxBytes) {
    return { tooLarge: true, size: stats.size }
  }
  const bytes = readFileSync(abs)
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** FORMAT.md "Limits": a line is at most 1 MiB. */
const MAX_LINE_BYTES = 1024 * 1024

export type MarkdownDecode = { ok: true; text: string } | { ok: false; reason: string }

/**
 * Decode a `.md` file's bytes, or say why it cannot be one note's text.
 *
 * Every refusal here mirrors a limit the kernel itself enforces, so a file that
 * decodes is a file that will commit. The alternative — a lenient decode with
 * replacement characters — would put bytes in `md.text` that the file does not
 * contain, which is exactly the claim D-10 forbids.
 */
export function decodeMarkdown(bytes: Buffer): MarkdownDecode {
  if (bytes.includes(0)) {
    return { ok: false, reason: 'contains a NUL byte' }
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, reason: 'is not valid UTF-8' }
  }

  // Measured in bytes, not characters: the kernel's limit is a byte limit, and
  // a line of 600,000 emoji is over it while being well under it in characters.
  let lineStart = 0
  for (let i = 0; i <= bytes.length; i += 1) {
    if (i === bytes.length || bytes[i] === 0x0a) {
      if (i - lineStart > MAX_LINE_BYTES) {
        return { ok: false, reason: 'has a line longer than 1 MiB' }
      }
      lineStart = i + 1
    }
  }

  return { ok: true, text }
}
