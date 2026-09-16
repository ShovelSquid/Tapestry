/**
 * SettingsStore — `userData/settings.json`, the app's small persistent
 * preferences file.
 *
 * It holds the user name that signs every human commit (D-07), whether agents
 * may connect, and the trees open in the space with their frame positions.
 *
 * The file is user-editable plain JSON, so nothing read from it is trusted:
 * a hand-edited `userName` with a space or a line break would otherwise be
 * spliced straight into an `actor` line. Every field is validated on read and
 * an invalid one falls back to its default rather than propagating.
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
  version: 1
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
   * Read and validate the settings file.
   *
   * A missing, unreadable or unparseable file reads as defaults — a corrupted
   * preferences file is an inconvenience, never a failure to start.
   */
  read(): AppSettings {
    let raw: unknown
    try {
      if (!existsSync(this.path)) return { ...DEFAULT_SETTINGS, trees: [] }
      raw = JSON.parse(readFileSync(this.path, 'utf-8'))
    } catch {
      return { ...DEFAULT_SETTINGS, trees: [] }
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ...DEFAULT_SETTINGS, trees: [] }
    }
    const parsed = raw as Record<string, unknown>

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

    return { version: 1, userName, agentsEnabled, trees }
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

  /** Read, transform and write back, returning the written settings. */
  update(mutator: (settings: AppSettings) => AppSettings): AppSettings {
    const next = mutator(this.read())
    this.write(next)
    return next
  }

  /**
   * Write atomically: a temp file in the same directory, then a rename over
   * the target. A crash mid-write leaves the previous settings intact instead
   * of a truncated file.
   *
   * Failures propagate. Silently swallowing them would let the app report a
   * saved name that was never written.
   */
  private write(settings: AppSettings): void {
    const tmpPath = `${this.path}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
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
