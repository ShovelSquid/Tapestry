/**
 * SettingsStore — `userData/settings.json`, the app's small persistent
 * preferences file.
 *
 * It holds the user name that signs every human commit (D-07) and whether
 * agents may connect. Until phase 2.6 it also held the trees open in the space
 * with their frame positions; from 2.6 that arrangement moves to the forest
 * tree (2.6 D-01 supersedes 2.2 D-18), and the `trees` list here becomes the
 * readable backup it was imported from.
 *
 * The file is user-editable plain JSON, so nothing read from it is trusted:
 * a hand-edited `userName` with a space or a line break would otherwise be
 * spliced straight into an `actor` line. Every field is validated on read and
 * an invalid one falls back to its default rather than propagating.
 *
 * Writes are a passthrough, not a rewrite. Every top-level key this build does
 * not understand is written back with its value, and the raw `trees` value is
 * written back exactly as found unless a legacy tree writer replaced it. So
 * the old list stays an untouched backup (2.6 D-10), and a file written by a
 * newer or older build sharing this userData is not damaged by this one
 * (2.6 RESEARCH Pitfall 6). `version` is read from the file and never lowered.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { isAbsolute, join, resolve } from 'path'
import { isValidActorName } from './commands/actor'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where a tree's frame sits in the space (D-15). */
export interface TreeFrameSetting {
  x: number
  y: number
}

/** One tree open in the space. */
export interface TreeSetting {
  /** Absolute path of the `.tree` file. */
  path: string
  /** A Tapestry-native world, or the mirror of an Obsidian vault. */
  kind: 'native' | 'vault'
  /** For `vault` trees, the absolute path of the vault folder. */
  vaultRoot?: string
  frame: TreeFrameSetting
}

export interface AppSettings {
  /**
   * The file's own version when it is a positive safe integer, otherwise 1.
   * Written back as found; this build never raises it.
   */
  version: number
  /** The `<name>` in `actor human user.<name>`, or null before first run. */
  userName: string | null
  agentsEnabled: boolean
  trees: TreeSetting[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  userName: null,
  agentsEnabled: true,
  trees: [],
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Absolute, no ".." segment. Shared by tree paths and vault roots. */
function isSafeAbsolutePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (!isAbsolute(value)) return false
  return !value.split(/[\\/]/).includes('..')
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Validate one entry from the `trees` array, returning a normalized copy or
 * null. A malformed entry is dropped rather than failing the whole read: one
 * bad line must not cost the user their name and their other trees.
 */
function validateTree(raw: unknown): TreeSetting | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>

  if (!isSafeAbsolutePath(entry.path)) return null
  if (!resolve(entry.path).endsWith('.tree')) return null

  if (entry.kind !== 'native' && entry.kind !== 'vault') return null

  if (entry.vaultRoot !== undefined && !isSafeAbsolutePath(entry.vaultRoot)) return null

  const frame = entry.frame
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null
  const { x, y } = frame as Record<string, unknown>
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null

  const validated: TreeSetting = {
    path: entry.path,
    kind: entry.kind,
    frame: { x, y },
  }
  if (typeof entry.vaultRoot === 'string') {
    validated.vaultRoot = entry.vaultRoot
  }
  return validated
}

/** A positive safe integer read from the file's `version`, or null. */
function validVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * Validate the parsed file into the fields this build understands. A null
 * (missing or unparseable file) reads as defaults.
 */
function validateSettings(parsed: Record<string, unknown> | null): AppSettings {
  if (!parsed) return { ...DEFAULT_SETTINGS, trees: [] }

  const version = validVersion(parsed.version) ?? DEFAULT_SETTINGS.version

  const userName = isValidActorName(parsed.userName) ? parsed.userName : null

  const agentsEnabled =
    typeof parsed.agentsEnabled === 'boolean'
      ? parsed.agentsEnabled
      : DEFAULT_SETTINGS.agentsEnabled

  const trees: TreeSetting[] = []
  if (Array.isArray(parsed.trees)) {
    for (const entry of parsed.trees) {
      const validated = validateTree(entry)
      if (validated) trees.push(validated)
    }
  }

  return { version, userName, agentsEnabled, trees }
}

// ---------------------------------------------------------------------------
// SettingsStore
// ---------------------------------------------------------------------------

export class SettingsStore {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  /** Absolute path of the settings file. */
  get path(): string {
    return join(this.dir, 'settings.json')
  }

  /**
   * Parse the file once, returning its top-level object, or null for a
   * missing, unreadable, unparseable or non-object file.
   */
  private readRaw(): Record<string, unknown> | null {
    let raw: unknown
    try {
      if (!existsSync(this.path)) return null
      raw = JSON.parse(readFileSync(this.path, 'utf-8'))
    } catch {
      return null
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw as Record<string, unknown>
  }

  /**
   * Read and validate the settings file.
   *
   * A missing, unreadable or unparseable file reads as defaults — a corrupted
   * preferences file is an inconvenience, never a failure to start.
   */
  read(): AppSettings {
    return validateSettings(this.readRaw())
  }

  /**
   * The legacy `trees` list for the one-time import into the forest tree.
   *
   * `skipped` counts raw entries that do not validate, so the import can say
   * how many it left behind (2.6 RESEARCH case J). Those entries stay in the
   * file: this reads, it never cleans.
   */
  readLegacyTrees(): { trees: TreeSetting[]; skipped: number } {
    const raw = this.readRaw()
    const trees = validateSettings(raw).trees
    const rawTrees = raw?.trees
    const skipped = Array.isArray(rawTrees) ? rawTrees.length - trees.length : 0
    return { trees, skipped }
  }

  /** The stored user name, or null when none has been chosen yet. */
  getUserName(): string | null {
    return this.read().userName
  }

  /** Store the user name. Throws rather than persisting an unusable value. */
  setUserName(name: unknown): void {
    if (!isValidActorName(name)) {
      throw new Error('Invalid user name')
    }
    this.update((settings) => ({ ...settings, userName: name }))
  }

  /**
   * Record a tree as open in the space, ignoring a path already listed.
   *
   * Reopening a path that is already recorded must not move its frame: the
   * stored position is where the user put it.
   */
  addTree(entry: TreeSetting): void {
    this.update((settings) => {
      if (settings.trees.some((tree) => tree.path === entry.path)) return settings
      return { ...settings, trees: [...settings.trees, entry] }
    })
  }

  /** Move a tree's frame. A path that is not listed is left alone. */
  setTreeFrame(path: string, frame: TreeFrameSetting): void {
    this.update((settings) => ({
      ...settings,
      trees: settings.trees.map((tree) =>
        tree.path === path ? { ...tree, frame: { x: frame.x, y: frame.y } } : tree,
      ),
    }))
  }

  /** Forget a tree. Its file and history are untouched — this is the space. */
  removeTree(path: string): void {
    this.update((settings) => ({
      ...settings,
      trees: settings.trees.filter((tree) => tree.path !== path),
    }))
  }

  /**
   * Adopt a Phase 2 `last-opened.json` as the first entry in `trees` (D-18).
   *
   * There is no forest file: the open trees live in settings. Someone
   * upgrading has one world recorded in the old file, and losing it on upgrade
   * would look exactly like losing the world. It is placed at frame (0, 0), so
   * a single migrated tree renders where the single-tree canvas used to.
   *
   * Runs at most once without needing a flag: a non-empty `trees` means the
   * migration has already happened (or the user has since opened something),
   * and either way the old file is no longer the truth. Returns whether it
   * migrated, so the caller can tell a first upgrade from an ordinary launch.
   */
  migrateLastOpened(lastOpenedFile: string): boolean {
    if (this.read().trees.length > 0) return false

    let treePath: unknown
    try {
      if (!existsSync(lastOpenedFile)) return false
      const parsed = JSON.parse(readFileSync(lastOpenedFile, 'utf-8'))
      treePath = parsed?.path
    } catch {
      // A corrupted or unreadable file migrates nothing, rather than failing
      // the launch it is only meant to improve.
      return false
    }

    if (!isSafeAbsolutePath(treePath)) return false
    if (!resolve(treePath).endsWith('.tree')) return false
    // A path recorded for a file that has since been deleted or moved would
    // reopen as an error on every launch; treat it as nothing to migrate.
    if (!existsSync(treePath)) return false

    this.update((settings) => ({
      ...settings,
      trees: [{ path: treePath as string, kind: 'native', frame: { x: 0, y: 0 } }],
    }))
    return true
  }

  /**
   * Read, transform and write back, returning the written settings.
   *
   * Only a mutator that returns a new `trees` array (the legacy tree writers)
   * rewrites the list; every other write leaves the raw `trees` value alone.
   */
  update(mutator: (settings: AppSettings) => AppSettings): AppSettings {
    const current = this.read()
    const next = mutator(current)
    this.write(next, { treesReplaced: next.trees !== current.trees })
    return next
  }

  /**
   * Merge the known fields over the file as it is on disk and write the
   * result atomically: a temp file in the same directory, then a rename over
   * the target. A crash mid-write leaves the previous settings intact instead
   * of a truncated file.
   *
   * Unknown top-level keys keep their values and their order. `trees` is the
   * raw value from disk unless the mutator replaced it. `version` is never
   * written lower than a valid version already in the file.
   *
   * Failures propagate. Silently swallowing them would let the app report a
   * saved name that was never written.
   */
  private write(settings: AppSettings, opts: { treesReplaced: boolean }): void {
    const raw = this.readRaw() ?? {}
    const merged: Record<string, unknown> = { ...raw }

    for (const [key, value] of Object.entries(settings)) {
      if (key === 'trees') continue
      merged[key] = value
    }

    const fileVersion = validVersion(raw.version)
    if (fileVersion !== null && fileVersion > settings.version) {
      merged.version = fileVersion
    }

    if (opts.treesReplaced || !Object.prototype.hasOwnProperty.call(raw, 'trees')) {
      merged.trees = settings.trees
    }

    const tmpPath = `${this.path}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8')
    renameSync(tmpPath, this.path)
  }
}

// ---------------------------------------------------------------------------
// First-run name suggestion
// ---------------------------------------------------------------------------

/** Lowercase the first word and drop everything outside [a-z0-9_-]. */
function toActorName(source: string | null): string | null {
  if (typeof source !== 'string') return null
  const firstWord = source.trim().split(/\s+/)[0] ?? ''
  const cleaned = firstWord.toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return isValidActorName(cleaned) ? cleaned : null
}

/**
 * Suggest a user name for the first-run prompt.
 *
 * "Kaelen Cook" becomes "kaelen": the first name is what a person calls
 * themselves, and it is what will read best in `actor human user.kaelen`.
 * Falls back to the account name, then to "me" — the prompt is never shown
 * with an empty field.
 */
export function suggestUserName(fullName: string | null, accountName: string): string {
  return toActorName(fullName) ?? toActorName(accountName) ?? 'me'
}
