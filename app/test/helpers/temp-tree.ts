/**
 * Temp-directory and temp-`.tree` helpers for tests.
 *
 * These run against the real native addon rather than a mock: the behaviors
 * this phase asserts (actor lines in the journal, reopen status, commit
 * ordering) only exist once the C++ kernel has written the file.
 *
 * Every path produced here passes through assertNotRealData first.
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { KernelBridge } from '../../src/main/kernel-bridge'
import { assertNotRealData } from './real-data-guard'

/** Create a fresh temp directory named `tapestry-<prefix>-XXXXXX`. */
export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `tapestry-${prefix}-`))
  assertNotRealData(dir)
  return dir
}

export interface TempTree {
  /** The temp directory holding the world. */
  dir: string
  /** Absolute path of the `.tree` file. */
  path: string
  /** An open bridge on that world. */
  bridge: KernelBridge
  /** Release the journal lock and delete the directory. */
  cleanup(): void
}

/**
 * Create a temp world and return an open bridge on it.
 *
 * cleanup() must be called (typically from afterEach): the addon holds
 * flock(LOCK_EX) until the kernel is closed, so leaking a bridge makes the
 * next test that opens the same path fail nondeterministically.
 */
export function createTempTree(name = 'test'): TempTree {
  const dir = makeTempDir(name)
  const path = join(dir, `${name}.tree`)
  assertNotRealData(path)

  const bridge = new KernelBridge()
  bridge.create(path, name)

  return {
    dir,
    path,
    bridge,
    cleanup(): void {
      try {
        bridge.close()
      } catch {
        // Already closed, or the world was never opened.
      }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
