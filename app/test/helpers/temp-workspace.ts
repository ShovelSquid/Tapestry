/**
 * Temp-workspace helper — the only workspace folder any automated test opens.
 *
 * Every file is synthetic and written here. The real worktrees (~/Tapestrees)
 * and the primary checkout (~/Tapestry) are real-data roots the guard refuses;
 * they are opened only in the dogfood check, with Kaelen present.
 */

import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { makeTempDir } from './temp-tree'
import { assertNotRealData } from './real-data-guard'

export interface TempWorkspace {
  /** The temp directory holding everything. */
  dir: string
  /** The workspace folder — `<dir>/Work Space`. */
  root: string
  /** A sibling folder outside the workspace, holding secret.txt. */
  outside: string
  /** Where workspace trees go — `<dir>/app-data/workspaces`. */
  treesDir: string
  cleanup(): void
}

export const HELLO_LINE = "export const greeting = 'hello'"
export const CRLF_BYTES = Buffer.from('first line\r\nsecond line\r\n', 'utf-8')
export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 0),
])

/** The git environment every test process runs with (no global config). */
export function isolateGit(): void {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
}

export function makeTempWorkspace(opts: { git?: boolean } = {}): TempWorkspace {
  const dir = makeTempDir('workspace')
  const root = join(dir, 'Work Space')
  const outside = join(dir, 'outside')
  const treesDir = join(dir, 'app-data', 'workspaces')
  assertNotRealData(root)
  assertNotRealData(treesDir)

  mkdirSync(join(root, 'src', 'nested'), { recursive: true })
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
  mkdirSync(join(root, 'out'), { recursive: true })
  mkdirSync(outside, { recursive: true })

  writeFileSync(join(outside, 'secret.txt'), 'outside secret\n')
  writeFileSync(join(root, 'README.md'), '# Work Space\n\nA synthetic workspace.\n')
  writeFileSync(join(root, 'src', 'hello.ts'), `${HELLO_LINE}\n\nexport default greeting\n`)
  writeFileSync(join(root, 'src', 'nested', 'deep.txt'), 'deep text\n')
  writeFileSync(join(root, 'scripts', 'run.sh'), '#!/bin/sh\necho run\n')
  chmodSync(join(root, 'scripts', 'run.sh'), 0o755)
  writeFileSync(join(root, 'crlf.txt'), CRLF_BYTES)
  writeFileSync(join(root, 'image.png'), PNG_BYTES)
  writeFileSync(join(root, '.gitignore'), 'node_modules/\nout/\n.env\n')
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n')
  writeFileSync(join(root, 'out', 'build.js'), 'built\n')
  writeFileSync(join(root, '.env'), 'SECRET=1\n')
  symlinkSync(outside, join(root, 'link-out'))
  symlinkSync('../README.md', join(root, 'src', 'link.txt'))

  isolateGit()
  if (opts.git !== false) {
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    }
    git('init', '-q')
    git('add', '-A')
    git(
      '-c',
      'user.name=tapestry-test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'fixture',
    )
  }

  return {
    dir,
    root,
    outside,
    treesDir,
    cleanup(): void {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * A digest of every entry under `dir`, walked with lstat: file bytes and mode,
 * link targets, and folder names. Two equal digests mean nothing was written.
 */
export function hashTree(dir: string): string {
  const hash = createHash('sha256')
  const visit = (abs: string, rel: string): void => {
    const stats = lstatSync(abs)
    if (stats.isSymbolicLink()) {
      hash.update(`L ${rel} ${readlinkSync(abs)}\n`)
    } else if (stats.isDirectory()) {
      hash.update(`D ${rel}\n`)
      for (const name of readdirSync(abs).sort()) visit(join(abs, name), `${rel}/${name}`)
    } else {
      hash.update(`F ${rel} ${stats.mode & 0o7777} `)
      hash.update(readFileSync(abs))
      hash.update('\n')
    }
  }
  visit(dir, '')
  return hash.digest('hex')
}
