/**
 * Real-data guard — the hard boundary between the test suite and Kaelen's
 * actual notes.
 *
 * Tapestry's tests exercise the real native addon against real `.tree` files.
 * Nothing in that machinery distinguishes a throwaway world in /tmp from
 * `~/Documents/we.tree` or the House Party vault, so the distinction is made
 * here and enforced by every temp helper before a path is touched.
 *
 * The real vault and the real worlds are opened only in end-of-phase manual
 * verification, with Kaelen present. Never from a test.
 */

import { existsSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'

/**
 * Directories that hold real user data. Resolved absolute paths.
 *
 * - `~/House Party` — the Obsidian vault this phase bridges to
 * - `~/Documents`   — holds `we.tree`, the live Tapestry world
 * - `~/Tapestry Tales` — the shared memory vault
 */
export const REAL_DATA_ROOTS: readonly string[] = Object.freeze([
  resolve(join(homedir(), 'House Party')),
  resolve(join(homedir(), 'Documents')),
  resolve(join(homedir(), 'Tapestry Tales')),
])

/**
 * The same roots with symlinks resolved, so a path reached through a
 * differently-spelled route still matches. A root that does not exist keeps
 * its literal form.
 */
const REAL_DATA_ROOTS_RESOLVED: readonly string[] = Object.freeze(
  REAL_DATA_ROOTS.map((root) => {
    try {
      return realpathSync(root)
    } catch {
      return root
    }
  }),
)

/** Whether `candidate` is one of the roots or lives inside one of them. */
function isInsideAnyRoot(candidate: string): boolean {
  for (const root of [...REAL_DATA_ROOTS, ...REAL_DATA_ROOTS_RESOLVED]) {
    if (candidate === root) return true
    const rel = relative(root, candidate)
    // relative() returns '' for the root itself and a '..'-prefixed path for
    // anything outside it. A sibling such as `~/DocumentsOld` therefore does
    // not match, while `~/Documents/we.tree` does.
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) return true
  }
  return false
}

/**
 * Resolve `p` through symlinks as far as the filesystem allows.
 *
 * A path that does not exist yet (the usual case — a `.tree` about to be
 * created) cannot be realpath'd directly, so the nearest existing ancestor is
 * resolved and the not-yet-existing tail is re-appended. That catches a temp
 * directory which is itself a symlink into a real-data root.
 */
function resolveThroughSymlinks(p: string): string {
  let existing = resolve(p)
  const tail: string[] = []

  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) break
    tail.unshift(basename(existing))
    existing = parent
  }

  let realBase = existing
  try {
    realBase = realpathSync(existing)
  } catch {
    // Unreadable ancestor — fall back to the lexically resolved form.
  }

  return tail.length > 0 ? join(realBase, ...tail) : realBase
}

/**
 * Throw unless `p` is safely outside every real-data root.
 *
 * Both the lexically resolved path and its symlink-resolved form are checked,
 * so neither `~/Documents/../Documents/we.tree` nor a symlinked temp dir can
 * slip past.
 */
export function assertNotRealData(p: string): void {
  const resolved = resolve(p)
  if (isInsideAnyRoot(resolved) || isInsideAnyRoot(resolveThroughSymlinks(p))) {
    throw new Error(`Refusing to touch real user data: ${p}`)
  }
}
