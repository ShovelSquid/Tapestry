/**
 * Per-thread defaults and the D-27 stored frame — ordinary readable node
 * properties (D-10, D-13, D-27), never a new kernel value type.
 *
 * Pure TypeScript: no Electron, Node or DOM import (see grammar.ts's header
 * for why that matters). `plugins/tapestry-threads/index.js` cannot import
 * this module directly — plugins are loaded with a raw Node `require()` on a
 * plain `.js`/`.cjs` file (app/src/main/plugin-host.ts) — so its manifest
 * duplicates the type names inline, the same way `tapestry-notes/index.js`
 * does for its own schema; the values here are the single source of truth
 * for what those types default to.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The shape a node's stored properties arrive in from the kernel bridge. */
export interface ThreadNodeProps {
  [key: string]: { type: string; value: string | number | boolean } | undefined
}

/** D-27: origin + direction (unit vector) + roll. Forward-vector-plus-roll
 * is required over a quaternion because `0 0 -1` is readable in the `.tree`
 * file and four quaternion reals are not (project readability constraint). */
export interface ThreadFrame {
  origin: { x: number; y: number; z: number }
  direction: { x: number; y: number; z: number }
  roll: number
}

export interface ThreadSettings {
  /** Seconds of inactivity before a session times out (D-10). */
  timeout: number
  /** The slowdown curve, `"<afterSeconds>:<rate> ..."` (D-11/D-13). */
  slowdown: string
  /** The `thread.log` grammar version this thread was created with. */
  format: number
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** D-10: matches Apple Messages' timestamp spacing. */
export const THREAD_DEFAULT_TIMEOUT_SECONDS = 150

/** D-11's rough defaults: ~30/s after ~10s, ~10/s at ~30s, 1/s after a
 * minute, held at 1/s until the time-out. */
export const THREAD_DEFAULT_SLOWDOWN = '10:30 30:10 60:1'

export const THREAD_DEFAULT_FORMAT = 1

export function defaultThreadSettings(): ThreadSettings {
  return {
    timeout: THREAD_DEFAULT_TIMEOUT_SECONDS,
    slowdown: THREAD_DEFAULT_SLOWDOWN,
    format: THREAD_DEFAULT_FORMAT,
  }
}

/**
 * A new thread's frame: origin at the card's canvas position with z 0,
 * direction `0 0 -1` (today's fixed axis) and roll 0 (D-27). The cursor that
 * lets a person set this by hand ships in a later phase; every thread in
 * 2.3 renders on this default.
 */
export function defaultThreadFrame(cardX: number, cardY: number): ThreadFrame {
  return {
    origin: { x: cardX, y: cardY, z: 0 },
    direction: { x: 0, y: 0, z: -1 },
    roll: 0,
  }
}

// ---------------------------------------------------------------------------
// Reading back from stored properties
// ---------------------------------------------------------------------------

function readNumber(props: ThreadNodeProps, key: string, fallback: number): number {
  const prop = props[key]
  if (!prop) return fallback
  const value = Number(prop.value)
  return Number.isFinite(value) ? value : fallback
}

function readText(props: ThreadNodeProps, key: string, fallback: string): string {
  const prop = props[key]
  return typeof prop?.value === 'string' ? prop.value : fallback
}

/**
 * Reads a thread's D-27 frame from its stored properties, falling back to
 * the default per key when a key is absent — so `parseThreadFrame({})`
 * (a thread created before this property existed, or a malformed node)
 * reads exactly as a fresh default thread would.
 */
export function parseThreadFrame(props: ThreadNodeProps): ThreadFrame {
  const fallback = defaultThreadFrame(0, 0)
  return {
    origin: {
      x: readNumber(props, 'thread.origin.x', fallback.origin.x),
      y: readNumber(props, 'thread.origin.y', fallback.origin.y),
      z: readNumber(props, 'thread.origin.z', fallback.origin.z),
    },
    direction: {
      x: readNumber(props, 'thread.direction.x', fallback.direction.x),
      y: readNumber(props, 'thread.direction.y', fallback.direction.y),
      z: readNumber(props, 'thread.direction.z', fallback.direction.z),
    },
    roll: readNumber(props, 'thread.roll', fallback.roll),
  }
}

/** Reads a thread's per-thread settings, falling back to the defaults
 * per key when a key is absent (a thread created before a setting existed,
 * or a malformed node). */
export function parseThreadSettings(props: ThreadNodeProps): ThreadSettings {
  const fallback = defaultThreadSettings()
  return {
    timeout: readNumber(props, 'thread.timeout', fallback.timeout),
    slowdown: readText(props, 'thread.slowdown', fallback.slowdown),
    format: readNumber(props, 'thread.format', fallback.format),
  }
}

// ---------------------------------------------------------------------------
// Initial properties for node creation
// ---------------------------------------------------------------------------

/** One property value as the kernel bridge's `createNode`/`setProperty`
 * ops expect it. */
export interface KernelPropValue {
  type: 'text' | 'int' | 'real' | 'bool' | 'ref' | 'time'
  value: string | number | boolean
}

/**
 * The full set of initial properties for a freshly created thread node: the
 * D-27 frame, the D-10/D-13 settings, and an empty D-02 note body/title —
 * everything `App.tsx`'s create-thread path needs for one `createNode` op.
 */
export function threadInitialProperties(cardX: number, cardY: number): Record<string, KernelPropValue> {
  const frame = defaultThreadFrame(cardX, cardY)
  const settings = defaultThreadSettings()
  return {
    'thread.origin.x': { type: 'real', value: frame.origin.x },
    'thread.origin.y': { type: 'real', value: frame.origin.y },
    'thread.origin.z': { type: 'real', value: frame.origin.z },
    'thread.direction.x': { type: 'real', value: frame.direction.x },
    'thread.direction.y': { type: 'real', value: frame.direction.y },
    'thread.direction.z': { type: 'real', value: frame.direction.z },
    'thread.roll': { type: 'real', value: frame.roll },
    'thread.timeout': { type: 'real', value: settings.timeout },
    'thread.slowdown': { type: 'text', value: settings.slowdown },
    'thread.format': { type: 'int', value: settings.format },
    body: { type: 'text', value: '' },
    title: { type: 'text', value: '' },
  }
}
