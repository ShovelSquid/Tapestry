/**
 * The record shapes the Tapestry tree and the forest are written in (2.6 D-13).
 *
 * These names were approved at the 2.6 Plan 02 checkpoint on 2026-09-24
 * (answer `recommended`: Option A with every Recommended item; chosen by the
 * autonomy driver and queued for Kaelen's review, see 02.6-02-SUMMARY.md
 * § Checkpoint decisions). A `.tree` history is append-only and replay keeps
 * old names forever, so this file is the only place they are spelled.
 *
 * Two files, two jobs:
 *
 * - **The Tapestry tree** (`Tapestry.tree`, world `Tapestry`) is always open.
 *   In 2.6 its only job is to name the forest: a root node, a forest node
 *   carrying the forest's digest and path hint, and a `forest` edge between
 *   them. The reference is one-sided (answer 1.7): the forest does not name
 *   its Tapestry tree back, and member trees do not record which forest they
 *   belong to (answer 1.6).
 * - **The forest** (`Forest.tree`, world `Forest`) holds one space node and one
 *   stand-in per member tree. Each frame is a `placement` edge from the space
 *   node to a stand-in (D-01). A stand-in is identified on disk by its path
 *   hint plus digest (D-03); a registry `path:` id is never written.
 *
 * Frames write only `origin.x` and `origin.y`, both `real` (answer 1.4, D-04).
 * `origin.z`, `direction.x/y/z`, `roll` and `size.w/h` are left unwritten, and
 * the reader's guide states their defaults (02.6-3D-FRAMES.md §1-§2: x east,
 * y south, z up; default direction `0 0 -1` and roll 0, the identity).
 *
 * No `.tree` format change is involved. Node types and edge labels are tokens
 * and property keys match `[A-Za-z_][A-Za-z0-9_.:-]*` (FORMAT.md "Keys and
 * tokens"), so every name here is already legal in format version 1, and no
 * kernel verb or value type is added.
 *
 * Neighbouring names this must not be confused with: 2.2 already uses
 * `tapestry.forest/remote@1` for cross-tree stand-ins, which sits beside
 * `tapestry.forest/member@1` here. 2.5's note "placement" is a property on a
 * note node, not this edge; moving notes onto placement edges is phase 2.7.
 */

// ---------------------------------------------------------------------------
// The Tapestry tree
// ---------------------------------------------------------------------------

/** The Tapestry tree's root node. 2.4's lock ceiling hangs its properties here. */
export const HOME_ROOT_TYPE = 'tapestry.home/tapestry@1'

/** The Tapestry tree's reference to the forest: digest, path hint and title. */
export const HOME_FOREST_TYPE = 'tapestry.home/forest@1'

/** Edge from the root to the forest reference. */
export const HOME_FOREST_LABEL = 'forest'

// ---------------------------------------------------------------------------
// The forest
// ---------------------------------------------------------------------------

/**
 * A space: something things are placed in. Generic on purpose, so 2.7's
 * boards can reuse it; `kind` is only a renderer hint.
 */
export const SPACE_TYPE = 'tapestry.spaces/space@1'

/** A member tree's stand-in in the forest. */
export const MEMBER_TYPE = 'tapestry.forest/member@1'

/** Edge from a space to a thing placed in it. Carries the frame's origin. */
export const PLACEMENT_LABEL = 'placement'

// ---------------------------------------------------------------------------
// Property keys
// ---------------------------------------------------------------------------

/** A readable name for the node (`text`). */
export const KEY_TITLE = 'title'

/** A space's renderer hint, or a member's kind (`text`). */
export const KEY_KIND = 'kind'

/** A world's identity, `sha256:<hex>` of its header record (`text`). */
export const KEY_DIGEST = 'digest'

/** Where the file was last seen: an absolute path (`text`, answer 1.3). */
export const KEY_PATH_HINT = 'path.hint'

/** For a vault member, the vault folder it mirrors (`text`, answer 1.5). */
export const KEY_VAULT_ROOT_HINT = 'vault.root.hint'

/** A frame's origin on the placement edge (`real`, D-04). */
export const KEY_ORIGIN_X = 'origin.x'
export const KEY_ORIGIN_Y = 'origin.y'

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export const SPACE_KIND_CANVAS = 'canvas'
export const MEMBER_KIND_NATIVE = 'native'
export const MEMBER_KIND_VAULT = 'vault'

export const FOREST_TITLE = 'Forest'
export const HOME_TITLE = 'Tapestry'

/** World names written in each file's header (answer 1.9). One token each. */
export const FOREST_WORLD = 'Forest'
export const HOME_WORLD = 'Tapestry'

/** File names inside the space folder, default `~/Documents/Tapestry/` (D-06). */
export const FOREST_FILE = 'Forest.tree'
export const HOME_FILE = 'Tapestry.tree'

/**
 * Where the Tapestry tree lives (answer 1.10): `'space-dir'` is beside the
 * forest, readable without the app; `'user-data'` would be hidden with the
 * settings.
 */
export const HOME_LOCATION: 'space-dir' | 'user-data' = 'space-dir'

// ---------------------------------------------------------------------------
// settings.json (answers 2.1, 2.2)
// ---------------------------------------------------------------------------

/** The top-level key holding `{ path }` of the Tapestry tree. */
export const SETTINGS_POINTER_KEY = 'tapestry'

/** The version written with the pointer. */
export const SETTINGS_VERSION = 2

// ---------------------------------------------------------------------------
// Commit messages (answer 1.12)
// ---------------------------------------------------------------------------

/** The one system commit that creates the forest from settings.json. */
export function importMessage(count: number, skipped: number): string {
  const base = `import ${count} trees and their frames from settings.json`
  return skipped > 0 ? `${base}; skipped ${skipped} unreadable entries` : base
}

/** The one system commit that creates the Tapestry tree. */
export function createHomeMessage(forestFile: string): string {
  return `create Tapestry tree referencing ${forestFile}`
}

/** One drop: the dragged frame and every frame it pushed aside (D-11). */
export function moveFrameMessage(name: string, pushed: number): string {
  const base = `move frame "${name}"`
  return pushed > 0 ? `${base} and push ${pushed} aside` : base
}

/**
 * The person undid a drop: every frame it moved is written back (D-09). A new
 * commit, never a rewind. `name` is the frame that was dragged.
 */
export function undoMoveFrameMessage(name: string): string {
  return `undo move frame "${name}"`
}

/** The person redid a drop they had undone (D-09). */
export function redoMoveFrameMessage(name: string): string {
  return `redo move frame "${name}"`
}

/** The system moved a frame clear of its neighbours when it first appeared (D-12). */
export function fitFrameMessage(name: string): string {
  return `fit frame "${name}" beside its neighbours`
}

/** The person put a tree in the space, or opened a member from its new path (D-03). */
export function addTreeMessage(name: string): string {
  return `add tree "${name}"`
}

/** The person took a tree out of the space; its last frame stays in history. */
export function removeTreeMessage(name: string): string {
  return `remove tree "${name}" from the forest`
}

/** The system wrote a member's digest the first time its world opened (D-03). */
export function recordIdentityMessage(name: string): string {
  return `record identity of "${name}"`
}

/** The system folded away a stand-in that turned out to be another member's world. */
export function forgetDuplicateMessage(name: string, file: string, other: string): string {
  return `forget "${name}" at ${file}: it is the same world as "${other}"`
}
