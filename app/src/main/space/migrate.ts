/**
 * Launch resolution for the space: which Tapestry tree and forest to open,
 * and the one-time import of the old settings arrangement (2.6 D-10, D-14).
 *
 * The approved order (answer 2.4) is: create the folder, create the forest in
 * one system commit, create the Tapestry tree in one system commit, and only
 * then write the settings pointer. A failure anywhere before the pointer
 * leaves settings.json byte-identical, so the next launch tries again.
 *
 * Nothing here ever writes into a file it did not just create, repairs a
 * journal, or rewrites the old `trees` list, which stays in settings.json as
 * the readable backup it was imported from.
 *
 * Every path is injected (`SpacePaths`), so tests never touch the real
 * `~/Documents/Tapestry` folder.
 */

import { rmSync } from 'fs'
import { basename, dirname } from 'path'
import { SYSTEM_ACTOR } from '../commands/actor'
import { isSafeTreePath, readLastOpenedTree } from '../settings'
import type { SettingsStore } from '../settings'
import { ForestStore } from './forest-store'
import type { MemberSeed, OpenProblem } from './forest-store'
import { TapestryHome } from './home-tree'
import { FOREST_FILE, createHomeMessage, importMessage } from './shapes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where the space's files are. All absolute, all injected. */
export interface SpacePaths {
  /** The forest, default `~/Documents/Tapestry/Forest.tree` (answer 1.11). */
  forest: string
  /** The Tapestry tree, default `~/Documents/Tapestry/Tapestry.tree` (answer 1.10). */
  home: string
  /** Phase 2's `last-opened.json`, folded in when `trees` is empty (answer 2.5). */
  lastOpenedFile: string
}

export type SpaceProblemKind =
  | 'home-missing'
  | 'home-damaged'
  | 'home-locked'
  | 'home-foreign'
  | 'forest-missing'
  | 'forest-damaged'
  | 'forest-locked'
  | 'forest-foreign'
  | 'forest-mismatch'
  | 'not-set-up'
  | 'setup-failed'

/** Why the space did not open. Whenever one is returned, nothing was written. */
export interface SpaceProblem {
  kind: SpaceProblemKind
  /** The file concerned, or for `setup-failed` the space folder. */
  path: string
  reason?: string
}

/** What launch should do, decided from the pointer and which files exist. */
export type SpaceLaunch = 'import' | 'reopen' | 'recover-home' | 'recover-forest'

// ---------------------------------------------------------------------------
// Wording (answers 4.2-4.9, approved at the Plan 02 checkpoint)
// ---------------------------------------------------------------------------

/** 4.9: a space action while no space is open. */
export const SPACE_NOT_OPEN =
  "Your space isn't open, so trees can't be added, closed or moved right now."

/** 4.10: adding Tapestry's own forest or Tapestry tree, or a copy of either. */
export function reservedFileRefusal(fileName: string): string {
  return `${fileName} is Tapestry's own arrangement file and can't be added as a tree.`
}

/** 4.11: the file at a member's path now holds a different world. */
export function differentWorldReason(path: string): string {
  return `A different world is now at ${path}, so this tree's file can't be found.`
}

/** The sentence shown in the app-error banner for a problem (answer 4.1). */
export function problemMessage(problem: SpaceProblem): string {
  const file = basename(problem.path)
  const path = problem.path
  switch (problem.kind) {
    case 'home-missing':
      return `Tapestry can't find its Tapestry tree at ${path}. Your trees are untouched, but the space stays empty until the file is back. Nothing was written.`
    case 'forest-missing':
      return `Tapestry can't find your forest at ${path}. Your trees are untouched, but the space stays empty until the file is back. Nothing was written.`
    case 'home-damaged':
    case 'forest-damaged':
      return `${file} is damaged, so Tapestry won't open or write to it. Your trees are untouched, and the space stays empty until the file is restored. (${problem.reason ?? 'no reason given'})`
    case 'home-locked':
    case 'forest-locked':
      return 'Tapestry is already open in another window, so this window left your space closed. Quit the other window, then relaunch.'
    case 'forest-mismatch':
      return `${file} at ${path} isn't the forest your Tapestry tree names, so Tapestry left it alone. The space stays empty until the right file is back.`
    case 'home-foreign':
    case 'forest-foreign':
    case 'not-set-up':
      return `${file} at ${path} isn't a Tapestry file, so Tapestry left it alone and didn't set up your space.`
    case 'setup-failed':
      return `Tapestry couldn't set up your space in ${path}: ${problem.reason ?? 'unknown error'}. Nothing in settings.json was changed.`
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Which launch case applies (RESEARCH § Q8).
 *
 * A pointer means reopen (cases D-H), and the file it names is the one
 * checked, not the default path. Without a pointer, an existing Tapestry tree
 * is case B and a lone forest is case C: both mean an earlier setup stopped
 * part-way, and importing again would start a second identity. Otherwise this
 * is a first launch (case A).
 */
export function classifySpace(state: {
  pointer: string | null
  homeExists: boolean
  forestExists: boolean
}): SpaceLaunch {
  if (state.pointer !== null) return 'reopen'
  if (state.homeExists) return 'recover-home'
  if (state.forestExists) return 'recover-forest'
  return 'import'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function homeProblem(problem: OpenProblem, path: string): SpaceProblem {
  return { kind: `home-${problem.status}`, path, reason: problem.reason }
}

function forestProblem(problem: OpenProblem, path: string): SpaceProblem {
  return { kind: `forest-${problem.status}`, path, reason: problem.reason }
}

// ---------------------------------------------------------------------------
// Case A: first launch
// ---------------------------------------------------------------------------

/**
 * Import today's settings arrangement into a new forest and Tapestry tree.
 *
 * Every valid `trees` entry becomes a member in file order, vault entries
 * included, at exactly its stored frame. Malformed entries are skipped, left
 * in the file and counted in the commit message (case J). With no valid
 * entries, a Phase 2 last-opened.json that names an existing file becomes one
 * member at (0, 0) (answer 2.5). Both commits are signed `system tapestry`
 * (answer 2.3): nobody authored them at that moment.
 *
 * The pointer is written last, and `trees` is never written (D-10). If any
 * step throws, what this call created is removed and `setup-failed` is
 * returned with settings.json untouched.
 */
export function importFromSettings(
  settings: SettingsStore,
  paths: SpacePaths,
): { home: TapestryHome; forest: ForestStore } | SpaceProblem {
  const { trees, skipped } = settings.readLegacyTrees()

  const seeds: MemberSeed[] = trees.map((tree) => ({
    kind: tree.kind,
    pathHint: tree.path,
    ...(tree.kind === 'vault' && tree.vaultRoot !== undefined
      ? { vaultRootHint: tree.vaultRoot }
      : {}),
    origin: { x: tree.frame.x, y: tree.frame.y },
  }))

  if (seeds.length === 0) {
    const lastOpened = readLastOpenedTree(paths.lastOpenedFile)
    if (lastOpened !== null) {
      seeds.push({ kind: 'native', pathHint: lastOpened, origin: { x: 0, y: 0 } })
    }
  }

  let forest: ForestStore
  try {
    forest = ForestStore.createWithMembers(
      paths.forest,
      seeds,
      SYSTEM_ACTOR,
      importMessage(seeds.length, skipped),
    )
  } catch (err) {
    return { kind: 'setup-failed', path: dirname(paths.forest), reason: errorMessage(err) }
  }

  let home: TapestryHome
  try {
    home = TapestryHome.createReferencing(
      paths.home,
      { digest: forest.digest(), pathHint: forest.path },
      SYSTEM_ACTOR,
      createHomeMessage(FOREST_FILE),
    )
  } catch (err) {
    // The forest was created moments ago by this call and nothing points at
    // it yet, so removing it lets the next launch start cleanly from case A.
    forest.close()
    removeCreated(forest.path)
    return { kind: 'setup-failed', path: dirname(paths.home), reason: errorMessage(err) }
  }

  try {
    settings.setTapestryPointer(paths.home)
  } catch (err) {
    home.close()
    forest.close()
    removeCreated(home.path)
    removeCreated(forest.path)
    return { kind: 'setup-failed', path: dirname(paths.home), reason: errorMessage(err) }
  }

  return { home, forest }
}

/** Remove a file this module created in the same call. */
function removeCreated(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch (err) {
    console.error('[SpaceService] could not remove a half-made file:', err)
  }
}

// ---------------------------------------------------------------------------
// Cases D-H: the pointer is present
// ---------------------------------------------------------------------------

/**
 * Open the Tapestry tree the pointer names, then the forest it references.
 *
 * Missing, damaged, locked or foreign files become the matching problem
 * (cases E, F, G). A forest whose digest is not the one the Tapestry tree
 * names is a different world at that path, and is treated as missing
 * (case H). Any problem closes whatever this call opened, and nothing is
 * ever written or repaired.
 */
export function reopenFromPointer(
  homePath: string,
): { home: TapestryHome; forest: ForestStore } | SpaceProblem {
  const home = TapestryHome.open(homePath)
  if (!(home instanceof TapestryHome)) return homeProblem(home, homePath)

  let ref
  try {
    ref = home.forestRef()
  } catch (err) {
    home.close()
    return { kind: 'home-foreign', path: homePath, reason: errorMessage(err) }
  }
  if (ref === null) {
    home.close()
    return { kind: 'home-foreign', path: homePath, reason: 'It names no forest' }
  }

  // The hint is readable text anyone can edit; only a safe absolute `.tree`
  // path is ever opened (T-2.6-04).
  if (!isSafeTreePath(ref.pathHint)) {
    home.close()
    return { kind: 'forest-missing', path: ref.pathHint, reason: 'Not a usable path' }
  }

  const forest = ForestStore.open(ref.pathHint)
  if (!(forest instanceof ForestStore)) {
    home.close()
    return forestProblem(forest, ref.pathHint)
  }

  let digest: string
  try {
    digest = forest.digest()
  } catch (err) {
    forest.close()
    home.close()
    return { kind: 'forest-damaged', path: ref.pathHint, reason: errorMessage(err) }
  }
  if (digest !== ref.digest) {
    forest.close()
    home.close()
    return { kind: 'forest-mismatch', path: ref.pathHint }
  }

  return { home, forest }
}
