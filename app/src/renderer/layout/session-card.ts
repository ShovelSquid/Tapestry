/**
 * A session card's view state (02.8 D-05): its size, whether it is closed to
 * its header, and where its transcript is scrolled.
 *
 * All of it is renderer state, kept in localStorage under one key and keyed
 * by `<treeId>:<noteId>`. None of it is ever a commit, and none of it writes
 * the note's `width`/`height`: resizing, closing or scrolling a card leaves
 * the tree exactly as it was. Only sizes, a flag and scroll offsets are
 * stored; never message text, a token or a path.
 *
 * Storage is passed in, so tests use a Map. A storage that is missing, full
 * or throwing makes a card forget, never fail (PluginSurfaceLayer's rule).
 */

import { SESSION_HEIGHT, SESSION_WIDTH } from '../../shared/chat/transcript'

/** 280 is DEFAULT_NOTE_WIDTH; 240 is surface-windows' MIN_WINDOW_HEIGHT (UI-SPEC A-02). */
export const SESSION_CARD_MIN = Object.freeze({ width: 280, height: 240 })
/** Keeps a card inside one 1080p screen at 100% zoom. */
export const SESSION_CARD_MAX = Object.freeze({ width: 720, height: 960 })
/** Within this many px of the bottom, a transcript follows new text. */
export const NEAR_BOTTOM_PX = 48
export const CARD_VIEW_STORAGE_KEY = 'tapestry.chat.cardViews'

export interface CardView {
  width?: number
  height?: number
  closed?: boolean
  scrollTop?: number
  /** Whether the reader was at the bottom when the card was last scrolled. */
  atBottom?: boolean
}

export type CardViewStorage = Pick<Storage, 'getItem' | 'setItem'>

function clampOne(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** A card size inside the limits; a value that is not a finite number becomes the default. */
export function clampCardSize(size: { width: number; height: number }): { width: number; height: number } {
  return {
    width: clampOne(size.width, SESSION_CARD_MIN.width, SESSION_CARD_MAX.width, SESSION_WIDTH),
    height: clampOne(size.height, SESSION_CARD_MIN.height, SESSION_CARD_MAX.height, SESSION_HEIGHT),
  }
}

/** Only well-formed fields survive, sizes clamped. */
function cleanView(raw: unknown): CardView {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const view: CardView = {}
  if (typeof r.width === 'number' && Number.isFinite(r.width)) {
    view.width = clampOne(r.width, SESSION_CARD_MIN.width, SESSION_CARD_MAX.width, SESSION_WIDTH)
  }
  if (typeof r.height === 'number' && Number.isFinite(r.height)) {
    view.height = clampOne(r.height, SESSION_CARD_MIN.height, SESSION_CARD_MAX.height, SESSION_HEIGHT)
  }
  if (typeof r.closed === 'boolean') view.closed = r.closed
  if (typeof r.scrollTop === 'number' && Number.isFinite(r.scrollTop) && r.scrollTop >= 0) {
    view.scrollTop = r.scrollTop
  }
  if (typeof r.atBottom === 'boolean') view.atBottom = r.atBottom
  return view
}

function readAll(storage: CardViewStorage): Record<string, unknown> {
  try {
    const raw = storage.getItem(CARD_VIEW_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function viewKey(treeId: string, noteId: string): string {
  return `${treeId}:${noteId}`
}

/** One card's remembered view; `{}` when there is none or storage fails. */
export function readCardView(storage: CardViewStorage, treeId: string, noteId: string): CardView {
  return cleanView(readAll(storage)[viewKey(treeId, noteId)])
}

/** Merge a change into one card's remembered view. Never throws. */
export function writeCardView(storage: CardViewStorage, treeId: string, noteId: string, patch: CardView): void {
  try {
    const all = readAll(storage)
    const key = viewKey(treeId, noteId)
    all[key] = cleanView({ ...cleanView(all[key]), ...patch })
    storage.setItem(CARD_VIEW_STORAGE_KEY, JSON.stringify(all))
  } catch {
    // A convenience only: the card still works without it.
  }
}

/** Whether a scroller is within NEAR_BOTTOM_PX of its bottom. */
export function isNearBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_PX
}

/** The window's localStorage, or null where there is none (tests, a locked-down profile). */
export function browserCardViewStorage(): CardViewStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}
