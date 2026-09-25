/**
 * Reading a mirrored folder safely — shared by vaults (02.2) and workspaces
 * (02.7).
 *
 * Everything here treats the folder as hostile input, because it genuinely is
 * shared ground: editors, git, sync tools, other Claude sessions and Kaelen
 * all write into it while Tapestry is reading. So this module never follows a
 * symlink (T-02.2-33, T-02.7-02), never reads an unbounded file (T-02.2-34,
 * T-02.7-10), and never transcodes bytes it cannot decode — a file that will
 * not fit the `.tree` limits is described in words rather than mangled into
 * something that would then be recorded as what the file "says".
 *
 * Nothing here knows about Markdown or about any particular tree shape; the
 * vault's `vault-fs.ts` and the workspace service both sit on top of it.
 */

import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'fs'
import { lstat, readdir } from 'fs/promises'
import { join, resolve } from 'path'

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

export interface FolderEntry {
  /** Folder-relative, always with `/` separators. */
  rel: string
  kind: 'dir' | 'file' | 'symlink'
  size: number
  /** Inode, used to pair a rename while the app is running. */
  ino: number
  mtimeMs: number
}

function byRel(a: { rel: string }, b: { rel: string }): number {
  return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
}

/**
 * Every path under `root` the predicate does not ignore, sorted, with symlinks
 * recorded but never followed.
 *
 * `lstat` rather than `stat` is the whole mitigation for a link pointing at
 * `~/.ssh`: it becomes a `symlink` entry the mirror describes and refuses to
 * read, not a door out of the folder.
 */
export async function walkFolder(
  root: string,
  isIgnored: (rel: string) => boolean,
): Promise<FolderEntry[]> {
  const base = resolve(root)
  const out: FolderEntry[] = []

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
      if (isIgnored(rel)) continue

      const abs = join(dirAbs, name)
      let stats
      try {
        stats = await lstat(abs)
      } catch {
        continue
      }

      const common = { rel, size: stats.size, ino: stats.ino, mtimeMs: stats.mtimeMs }
      if (stats.isSymbolicLink()) {
        out.push({ ...common, kind: 'symlink' })
        continue
      }
      if (stats.isDirectory()) {
        out.push({ ...common, kind: 'dir' })
        await visit(abs, rel)
        continue
      }
      if (stats.isFile()) {
        out.push({ ...common, kind: 'file' })
      }
      // Anything else (a socket, a device node) is not folder content.
    }
  }

  await visit(base, '')
  out.sort(byRel)
  return out
}

/**
 * Entries for an explicit list of paths (git's view of a work tree).
 *
 * A listed path that no longer exists is skipped: git's index can name a file
 * deleted a moment ago. A listed path that is a directory — a submodule's
 * gitlink — is skipped rather than descended, because its contents belong to
 * another repository. Every ancestor folder of a listed file gets one `dir`
 * entry so the mirror can group it.
 */
export function entriesFromPaths(root: string, rels: string[]): FolderEntry[] {
  const base = resolve(root)
  const out: FolderEntry[] = []
  const dirs = new Set<string>()

  for (const rel of rels) {
    let stats
    try {
      stats = lstatSync(join(base, ...rel.split('/')))
    } catch {
      continue
    }
    if (stats.isDirectory()) continue

    const common = { rel, size: stats.size, ino: stats.ino, mtimeMs: stats.mtimeMs }
    if (stats.isSymbolicLink()) out.push({ ...common, kind: 'symlink' })
    else if (stats.isFile()) out.push({ ...common, kind: 'file' })
    else continue

    const segments = rel.split('/')
    for (let i = 1; i < segments.length; i += 1) {
      dirs.add(segments.slice(0, i).join('/'))
    }
  }

  for (const rel of dirs) {
    let stats
    try {
      stats = lstatSync(join(base, ...rel.split('/')))
    } catch {
      continue
    }
    out.push({ rel, kind: 'dir', size: stats.size, ino: stats.ino, mtimeMs: stats.mtimeMs })
  }

  out.sort(byRel)
  return out
}

// ---------------------------------------------------------------------------
// Git's view of a folder
// ---------------------------------------------------------------------------

const GIT_TIMEOUT_MS = 20000
const GIT_MAX_BUFFER = 64 * 1024 * 1024

function gitStderr(err: unknown): string {
  const e = err as { stderr?: Buffer | string; message?: string }
  const stderr = e?.stderr ? String(e.stderr).trim() : ''
  return stderr || e?.message || String(err)
}

/** Whether `root` is inside a git work tree. A missing git is `false`. */
export function isGitWorkTree(root: string): boolean {
  try {
    const out = execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
    })
    return out.trim() === 'true'
  } catch {
    return false
  }
}

/**
 * The files git would show: tracked, plus untracked-but-not-ignored.
 *
 * A failure after the work-tree check throws. It never returns an empty list,
 * because an empty list would read as "every file was deleted" (T-02.7-11).
 */
export function listGitFiles(root: string): { kind: 'git'; rels: string[] } | { kind: 'not-git' } {
  if (!isGitWorkTree(root)) return { kind: 'not-git' }

  let out: Buffer
  try {
    out = execFileSync(
      'git',
      ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER },
    )
  } catch (err) {
    throw new Error(`git could not list the files in ${root}: ${gitStderr(err)}`)
  }

  const rels = [...new Set(out.toString('utf-8').split('\0').filter((rel) => rel.length > 0))]
  return { kind: 'git', rels }
}

/**
 * Whether git ignores `rel`. A tracked file is never reported as ignored,
 * which is exactly the "git would show it" rule. Fails closed: any exit other
 * than 0 or 1 throws.
 */
export function isGitIgnored(root: string, rel: string): boolean {
  try {
    execFileSync('git', ['-C', root, 'check-ignore', '-q', '--', rel], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
    })
    return true
  } catch (err) {
    const status = (err as { status?: number | null }).status
    if (status === 1) return false
    throw new Error(`git could not check whether ${rel} is ignored: ${gitStderr(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type BoundedBytes = { bytes: Buffer; sha256: string } | { tooLarge: true; size: number }

/** 16 MiB. A single file larger than this is described, never loaded. */
export const MAX_MIRROR_READ_BYTES = 16 * 1024 * 1024

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Read one file and hash it.
 *
 * Opened with O_NOFOLLOW, so a file swapped for a symlink between the walk and
 * the read fails rather than being followed. The size is checked with fstat on
 * the open descriptor before a byte is allocated, so a 4 GiB file costs a stat
 * rather than the heap.
 */
export function readBoundedBytes(
  root: string,
  rel: string,
  maxBytes: number = MAX_MIRROR_READ_BYTES,
): BoundedBytes {
  const abs = join(resolve(root), ...rel.split('/'))
  const fd = openSync(abs, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stats = fstatSync(fd)
    if (stats.size > maxBytes) {
      return { tooLarge: true, size: stats.size }
    }
    const bytes = Buffer.alloc(stats.size)
    let offset = 0
    while (offset < bytes.length) {
      const n = readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (n === 0) break
      offset += n
    }
    const read = offset === bytes.length ? bytes : bytes.subarray(0, offset)
    return { bytes: read, sha256: sha256Hex(read) }
  } finally {
    closeSync(fd)
  }
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** FORMAT.md "Limits": a line is at most 1 MiB. */
const MAX_LINE_BYTES = 1024 * 1024

export type TextDecode = { ok: true; text: string } | { ok: false; reason: string }

/**
 * Decode a file's bytes, or say why they cannot be one note's text.
 *
 * Every refusal mirrors a limit the kernel itself enforces, so a file that
 * decodes is a file that will commit. A lenient decode with replacement
 * characters would record bytes the file does not contain.
 */
export function decodeText(bytes: Buffer): TextDecode {
  if (bytes.includes(0)) {
    return { ok: false, reason: 'contains a NUL byte' }
  }

  let text: string
  try {
    // ignoreBOM keeps a leading U+FEFF in the text: stripping it would record
    // (and later write back) bytes the file does not contain (D-03).
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return { ok: false, reason: 'is not valid UTF-8' }
  }

  // Measured in bytes, not characters: the kernel's limit is a byte limit.
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
