/**
 * SettingsStore — `userData/settings.json`, the app's small persistent
 * preferences file.
 *
 * It holds the user name that signs every human commit (D-07), whether
 * agents may connect, and the pointer to the Tapestry tree (2.6 D-02). Until
 * phase 2.6 it also held the trees open in the space with their frame
 * positions; from 2.6 that arrangement lives in the forest tree (2.6 D-01
 * supersedes 2.2 D-18), and the `trees` list here is the readable backup it
 * was imported from. Nothing in this build writes that list: the old tree
 * writers (`addTree`, `setTreeFrame`, `removeTree`, `migrateLastOpened`) were
 * deleted at the end of 2.6 (D-10, answer 2.2), and it is read only by the
 * one-time import (`readLegacyTrees`).
 *
 * The file is user-editable plain JSON, so nothing read from it is trusted:
 * a hand-edited `userName` with a space or a line break would otherwise be
 * spliced straight into an `actor` line. Every field is validated on read and
 * an invalid one falls back to its default rather than propagating.
 *
 * Writes are a passthrough, not a rewrite. Every top-level key this build does
 * not understand is written back with its value, and the raw `trees` value is
 * always written back exactly as found, even if a mutator returns a different
 * list; a file with no `trees` key keeps none. So the old list stays an
 * untouched backup (2.6 D-10), and a file written by a newer or older build
 * sharing this userData is not damaged by this one (2.6 RESEARCH Pitfall 6).
 * `version` is read from the file and never lowered.
 *
 * A file that exists but is not a readable JSON object (a trailing comma from
 * a hand edit, an array, a directory at the path) is never written over. Every
 * writer throws `SettingsUnreadableError` before anything reaches the disk and
 * leaves the file's bytes exactly as they are, so its `trees` backup and user
 * name survive until the person fixes it (2.6 gap 1, CR-01). Reading such a
 * file still yields defaults: it never stops the app from starting.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { isAbsolute, join, resolve } from 'path'
import { isValidActorName } from './commands/actor'
import { SETTINGS_POINTER_KEY, SETTINGS_VERSION } from './space/shapes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where a tree's frame sat in the space before 2.6 (D-15). Read only. */
export interface TreeFrameSetting {
  x: number
  y: number
}

/** One entry of the legacy `trees` list, as the one-time import reads it. */
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

/** A safe absolute path whose resolved form ends in `.tree`. */
export function isSafeTreePath(value: unknown): value is string {
  return isSafeAbsolutePath(value) && resolve(value).endsWith('.tree')
}

/**
 * Validate one entry from the `trees` array, returning a normalized copy or
 * null. A malformed entry is dropped rather than failing the whole read: one
 * bad line must not cost the user their name and their other trees.
 */
function validateTree(raw: unknown): TreeSetting | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>

  if (!isSafeTreePath(entry.path)) return null

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

/**
 * The tree a Phase 2 `last-opened.json` names, or null.
 *
 * The old file is untrusted input: a corrupted or unreadable file, a path that
 * is not a safe absolute `.tree` path, or a file that has since been deleted
 * or moved all read as nothing, rather than failing the launch this is only
 * meant to improve. Read by the 2.6 forest import (answer 2.5), which folds
 * it into the forest when `trees` is empty.
 */
export function readLastOpenedTree(lastOpenedFile: string): string | null {
  let treePath: unknown
  try {
    if (!existsSync(lastOpenedFile)) return null
    const parsed = JSON.parse(readFileSync(lastOpenedFile, 'utf-8'))
    treePath = parsed?.path
  } catch {
    return null
  }
  if (!isSafeTreePath(treePath)) return null
  return existsSync(treePath) ? treePath : null
}

// ---------------------------------------------------------------------------
// SettingsStore
// ---------------------------------------------------------------------------

/**
 * What is at the settings path: nothing to lose (`missing`, including an
 * empty or whitespace-only file), something that must not be written over
 * (`unreadable`), or a top-level JSON object (`ok`).
 */
type RawSettings =
  | { state: 'missing' }
  | { state: 'unreadable'; error: string }
  | { state: 'ok'; value: Record<string, unknown> }

/**
 * settings.json exists but is not a readable JSON object, so it was not
 * written (2.6 gap 1, CR-01). The message names the file and the reason.
 */
export class SettingsUnreadableError extends Error {
  readonly path: string
  readonly detail: string

  constructor(path: string, detail: string) {
    super(`${path} could not be read, so it was left untouched: ${detail}`)
    this.name = 'SettingsUnreadableError'
    this.path = path
    this.detail = detail
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

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
   * Parse the file once into one of three states.
   *
   * No file, or one that is empty or only whitespace, is `missing`: there is
   * nothing in it to lose. A file that cannot be read, does not parse, or
   * parses to something other than a plain object is `unreadable`, and no
   * writer may replace it (CR-01).
   */
  private readRaw(): RawSettings {
    if (!existsSync(this.path)) return { state: 'missing' }

    let text: string
    try {
      text = readFileSync(this.path, 'utf-8')
    } catch (err) {
      return { state: 'unreadable', error: errorText(err) }
    }
    if (text.trim().length === 0) return { state: 'missing' }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      return { state: 'unreadable', error: errorText(err) }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { state: 'unreadable', error: 'it is not a JSON object' }
    }
    return { state: 'ok', value: parsed as Record<string, unknown> }
  }

  /** The parsed object, or null when the file is missing or unreadable. */
  private readObject(): Record<string, unknown> | null {
    const raw = this.readRaw()
    return raw.state === 'ok' ? raw.value : null
  }

  /**
   * The object a writer merges over: the parsed file, or an empty object when
   * there is none. An unreadable file throws before anything is written.
   */
  private writableBase(): Record<string, unknown> {
    const raw = this.readRaw()
    if (raw.state === 'unreadable') throw new SettingsUnreadableError(this.path, raw.error)
    return raw.state === 'ok' ? raw.value : {}
  }

  /**
   * Throw `SettingsUnreadableError` when the file exists but is not a readable
   * JSON object. Launch calls this before creating or opening anything, so a
   * broken file stops setup instead of being replaced (2.6 gap 1, CR-01).
   */
  assertReadable(): void {
    const raw = this.readRaw()
    if (raw.state === 'unreadable') throw new SettingsUnreadableError(this.path, raw.error)
  }

  /**
   * Read and validate the settings file.
   *
   * A missing, unreadable or unparseable file reads as defaults — a corrupted
   * preferences file is an inconvenience, never a failure to start.
   */
  read(): AppSettings {
    return validateSettings(this.readObject())
  }

  /**
   * The legacy `trees` list for the one-time import into the forest tree.
   *
   * `skipped` counts raw entries that do not validate, so the import can say
   * how many it left behind (2.6 RESEARCH case J). Those entries stay in the
   * file: this reads, it never cleans.
   */
  readLegacyTrees(): { trees: TreeSetting[]; skipped: number } {
    const raw = this.readObject()
    const trees = validateSettings(raw).trees
    const rawTrees = raw?.trees
    const skipped = Array.isArray(rawTrees) ? rawTrees.length - trees.length : 0
    return { trees, skipped }
  }

  /**
   * The Tapestry tree's path from the pointer (2.6 D-02, answer 2.1), or null.
   *
   * The pointer decides which file is opened as the Tapestry tree, and the
   * file is hand-editable, so only a safe absolute `.tree` path is returned
   * (T-2.6-03). Anything else reads as no pointer at all.
   */
  getTapestryPointer(): string | null {
    const pointer = this.readObject()?.[SETTINGS_POINTER_KEY]
    if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer)) return null
    const path = (pointer as Record<string, unknown>).path
    return isSafeTreePath(path) ? path : null
  }

  /**
   * Write the pointer to the Tapestry tree and raise `version` to 2.
   *
   * This is the last step of the first-launch import (answer 2.4), so a crash
   * before it leaves settings.json exactly as it was. `trees` and every other
   * key are written back raw (D-10); `version` is never lowered (case I).
   * An unreadable file throws `SettingsUnreadableError` and is not written.
   */
  setTapestryPointer(path: string): void {
    if (!isSafeTreePath(path)) {
      throw new Error('Invalid Tapestry tree path')
    }
    const raw = this.writableBase()
    const fileVersion = validVersion(raw.version) ?? DEFAULT_SETTINGS.version
    this.writeRaw({
      ...raw,
      version: Math.max(fileVersion, SETTINGS_VERSION),
      [SETTINGS_POINTER_KEY]: { path },
    })
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
   * Read, transform and write back, returning what the mutator returned.
   *
   * The mutator's `trees` is ignored: the raw `trees` value on disk is written
   * back unchanged whatever it returns (D-10).
   */
  update(mutator: (settings: AppSettings) => AppSettings): AppSettings {
    const next = mutator(this.read())
    this.write(next)
    return next
  }

  /**
   * Merge the known fields over the file as it is on disk and write the
   * result atomically: a temp file in the same directory, then a rename over
   * the target. A crash mid-write leaves the previous settings intact instead
   * of a truncated file.
   *
   * Unknown top-level keys keep their values and their order. `trees` is
   * always the raw value from disk, or absent when the file has none: this
   * build never writes it (D-10). `version` is never written lower than a
   * valid version already in the file.
   *
   * Failures propagate. Silently swallowing them would let the app report a
   * saved name that was never written. An unreadable file throws
   * `SettingsUnreadableError` before any merge, and is not written (CR-01).
   */
  private write(settings: AppSettings): void {
    const raw = this.writableBase()
    const merged: Record<string, unknown> = { ...raw }

    for (const [key, value] of Object.entries(settings)) {
      if (key === 'trees') continue
      merged[key] = value
    }

    const fileVersion = validVersion(raw.version)
    if (fileVersion !== null && fileVersion > settings.version) {
      merged.version = fileVersion
    }

    this.writeRaw(merged)
  }

  /** Write a whole object atomically: a temp file, then a rename over the target. */
  private writeRaw(object: Record<string, unknown>): void {
    const tmpPath = `${this.path}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(object, null, 2)}\n`, 'utf-8')
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
