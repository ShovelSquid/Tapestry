/**
 * Writing a text file atomically, without ever following a symlink.
 *
 * The bytes go to a dot-named temp file beside the target, are fsynced, and
 * the temp file is renamed over the target. A reader therefore sees either the
 * old file or the new one, never half of each. The temp file is opened with
 * O_CREAT | O_EXCL | O_NOFOLLOW, so a link planted at the temp name is refused
 * rather than written through, and rename replaces the directory entry — a
 * symlink at the target is replaced, never its target written (T-02.7-02).
 *
 * The temp name carries TAPESTRY_TMP_MARKER so every mirror ignores it and the
 * sandbox refuses to hand it to an agent.
 */

import { randomBytes } from 'crypto'
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'fs'
import { basename, dirname, join } from 'path'

export const TAPESTRY_TMP_MARKER = '.tapestry-tmp'

/** The mode a new file is written with when there is no existing file. */
const DEFAULT_MODE = 0o644

function existingMode(abs: string): number | null {
  try {
    const stats = lstatSync(abs)
    return stats.isFile() ? stats.mode & 0o7777 : null
  } catch {
    return null
  }
}

/**
 * Replace `abs` with `text` (UTF-8), keeping the existing file's mode bits.
 * Throws on any failure, after removing its temp file.
 */
export function writeFileAtomicSync(abs: string, text: string, opts?: { mode?: number }): void {
  const mode = opts?.mode ?? existingMode(abs) ?? DEFAULT_MODE
  const tmp = join(
    dirname(abs),
    `.${basename(abs)}${TAPESTRY_TMP_MARKER}-${process.pid}-${randomBytes(4).toString('hex')}`,
  )

  let fd: number | null = null
  try {
    fd = openSync(
      tmp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    )
    // openSync's mode is filtered through the umask; fchmod makes the kept
    // mode bits exact.
    fchmodSync(fd, mode)
    const bytes = Buffer.from(text, 'utf-8')
    let offset = 0
    while (offset < bytes.length) {
      offset += writeSync(fd, bytes, offset, bytes.length - offset)
    }
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(tmp, abs)
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // Already closed.
      }
    }
    try {
      unlinkSync(tmp)
    } catch (unlinkErr) {
      if ((unlinkErr as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[writeFileAtomicSync] could not remove', tmp, unlinkErr)
      }
    }
    throw err
  }
}
