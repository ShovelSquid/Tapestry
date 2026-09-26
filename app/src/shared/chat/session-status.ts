/**
 * A chat session's status: its state, status text and level (Phase 2.8,
 * D-10..D-14, SC4).
 *
 * One pure reducer turns what was observed into what the card and the panel
 * show. Its inputs are the session's chat events in order (the engine's, the
 * person's `user`, and the service-level `status` that `set_status` produces)
 * and the person's acknowledgement (`ack`: the pointer rests on the card,
 * focus, the enlarged view, a send). Nothing is ever guessed from reply text:
 * Needs you comes only from `set_status` with `needs: true` or level 3, and
 * Failed only from an `error` or a failed `done`, so it can never come out as
 * Done.
 *
 * Status is chrome, never history (D-10). No part of this module's output
 * enters a tree, a commit or a hash. The only thing that outlives the renderer
 * is the last status text, which main keeps per session in chats.json
 * (outside every `.tree`) so a relaunch shows Idle with it (D-12).
 *
 * Pure TypeScript: no Electron, Node or DOM import, so main (which stores the
 * last status text), the renderer (which draws the state) and vitest all load
 * the identical module.
 */

import { isStatusTool, toolLabel, type TranscriptEvent } from './transcript'

/** The highest level a status may ask for until rank exists (D-14). */
export const STATUS_LEVEL_CEILING = 3

/** A level as an integer from 0 to the ceiling; anything unreadable is 0. */
export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return level > 0 ? STATUS_LEVEL_CEILING : 0
  return Math.min(STATUS_LEVEL_CEILING, Math.max(0, Math.trunc(level)))
}

// ---------------------------------------------------------------------------
// States and words
// ---------------------------------------------------------------------------

export type SessionState = 'idle' | 'working' | 'needs' | 'done' | 'failed'

/** The word before the status text; Idle has none (UI-SPEC § State words). */
export const STATE_WORDS: Readonly<Record<SessionState, string | null>> = Object.freeze({
  idle: null,
  working: 'Working',
  needs: 'Needs you',
  done: 'Done',
  failed: 'Failed',
})

/** Before anything has happened in a turn. */
export const READING_TEXT = 'Reading your message'
/** A session with no turns. */
export const NEW_CHAT_TEXT = 'New chat'
/** After Stop reply. */
export const STOPPED_TEXT = 'Stopped'
/** A failed `done` with no error event, or an error kind this module does not know. */
export const DIDNT_FINISH_PHRASE = "The turn didn't finish"

/** The Failed status line's short phrase, by ChatErrorKind (UI-SPEC § Failed short phrases). */
export const FAILED_PHRASES: Readonly<Record<string, string>> = Object.freeze({
  'not-installed': "Claude Code isn't installed",
  'signed-out': 'Claude Code is signed out',
  crashed: 'Claude Code stopped unexpectedly',
  protocol: 'Claude Code sent something unreadable',
  'bridge-off': 'Agents are turned off',
  'tools-unavailable': "Workspace tools didn't start",
  'session-lost': "The earlier conversation wasn't found",
  timeout: 'The turn ran over 30 minutes',
  'no-key': 'No API key is set',
  refused: 'The request was refused',
})

export function failedPhrase(kind: string | null): string {
  if (kind !== null && Object.prototype.hasOwnProperty.call(FAILED_PHRASES, kind)) return FAILED_PHRASES[kind]
  return DIDNT_FINISH_PHRASE
}

/** Done's level when the turn had no set_status (D-14). */
const DONE_DEFAULT_LEVEL = 2
/** Failed asks for attention like level 2 (A-07); it never animates (UI-SPEC § States). */
const FAILED_LEVEL = 2
/** Working is observed, not announced; its level only says the text updates. */
const WORKING_LEVEL = 1

// ---------------------------------------------------------------------------
// The status and its reducer
// ---------------------------------------------------------------------------

/** The chat events the reducer reads: the transcript's, plus the service-level `status`. */
export type StatusEvent = TranscriptEvent

export type StatusInput =
  | { kind: 'event'; event: StatusEvent }
  /** The person looked: pointer rest, focus, the enlarged view, a send. */
  | { kind: 'ack' }

export interface SessionStatus {
  state: SessionState
  /** The full status text (the enlarged view). */
  text: string
  /** What the card shows: a level-0 status changes `text` but not this (D-14). */
  cardText: string
  /** How much attention the current state asks for, 0 to the ceiling. */
  level: number
  /** Needs you was raised and no `user` event has come since. */
  needs: boolean
  /** The level of this turn's latest set_status, or null when none came (A-04). */
  turnLevel: number | null
  /** A set_status text arrived this turn, so tool calls and replies no longer change the text. */
  statusThisTurn: boolean
  /** When the current state arrived (the caller's clock), for motion and decay. */
  arrivedAt: number
}

/**
 * A session as main opens it (D-12). A relaunch has no engine, so `busy` is
 * false and the session is Idle with its last status text, never a stale
 * Working. With no last status text: 'New chat' for a session with no turns,
 * and an empty text for one whose turns predate the last status text (the
 * card then shows no status line text rather than a wrong one).
 */
export function initialStatus(options: { busy: boolean; lastStatus: string | null; turns?: number }): SessionStatus {
  const fallback = options.busy ? READING_TEXT : (options.turns ?? 0) > 0 ? '' : NEW_CHAT_TEXT
  const text = options.lastStatus ?? fallback
  return {
    state: options.busy ? 'working' : 'idle',
    text,
    cardText: text,
    level: options.busy ? WORKING_LEVEL : 0,
    needs: false,
    turnLevel: null,
    statusThisTurn: false,
    arrivedAt: 0,
  }
}

function firstLine(text: string): string {
  return text.split(/\r\n|\r|\n/).find((line) => line.trim().length > 0)?.trim() ?? ''
}

/** `status` with a new state, stamping arrivedAt only when the state changes. */
function enter(status: SessionStatus, state: SessionState, level: number, now: number): SessionStatus {
  return { ...status, state, level, arrivedAt: status.state === state ? status.arrivedAt : now }
}

/** New text for both the full line and the card. */
function withText(status: SessionStatus, text: string): SessionStatus {
  return status.text === text && status.cardText === text ? status : { ...status, text, cardText: text }
}

/**
 * The next status after one observed event or acknowledgement. Pure: the same
 * status and input always give the same result, and nothing is mutated.
 */
export function reduceStatus(status: SessionStatus, input: StatusInput, now: number): SessionStatus {
  if (input.kind === 'ack') {
    // Done and Failed become Idle when looked at, keeping their text.
    // Needs you clears only on a reply; Working and Idle have nothing to acknowledge.
    if (status.state !== 'done' && status.state !== 'failed') return status
    return enter(status, 'idle', 0, now)
  }

  const event = input.event
  switch (event.type) {
    case 'user':
      // A person's send in this session: a new turn, and the only thing
      // that clears Needs you (D-11).
      return {
        state: 'working',
        text: READING_TEXT,
        cardText: READING_TEXT,
        level: WORKING_LEVEL,
        needs: false,
        turnLevel: null,
        statusThisTurn: false,
        arrivedAt: status.state === 'working' ? status.arrivedAt : now,
      }

    case 'status': {
      const level = clampLevel(event.level)
      const next: SessionStatus = {
        ...status,
        text: event.text,
        // Level 0 is silent on the card (D-14).
        cardText: level > 0 ? event.text : status.cardText,
        turnLevel: level,
        statusThisTurn: true,
      }
      if (event.needs || level >= STATUS_LEVEL_CEILING) {
        return { ...enter(next, 'needs', STATUS_LEVEL_CEILING, now), needs: true }
      }
      if (next.state === 'working') return { ...next, level }
      return next
    }

    case 'tool-call':
      // A set_status call is carried by its status event, never by its name.
      if (status.statusThisTurn || isStatusTool(event.name)) return status
      return withText(status, toolLabel(event.name, event.input))

    case 'text': {
      if (status.statusThisTurn) return status
      const line = firstLine(event.text)
      return line.length > 0 ? withText(status, line) : status
    }

    case 'error':
      if (status.needs) return status
      return withText(enter(status, 'failed', FAILED_LEVEL, now), failedPhrase(event.kind))

    case 'done':
      // Needs you outlives the turn; Failed never turns into Done.
      if (status.needs) return status
      if (event.reason === 'stopped') return withText(enter(status, 'idle', 0, now), STOPPED_TEXT)
      if (status.state === 'failed') return status
      if (!event.ok) return withText(enter(status, 'failed', FAILED_LEVEL, now), DIDNT_FINISH_PHRASE)
      return enter(status, 'done', status.turnLevel ?? DONE_DEFAULT_LEVEL, now)

    case 'session':
    case 'text-delta':
    case 'tool-result':
    case 'notice':
      return status
  }
}

/**
 * The status line: `<State word> · <text>`, or the text alone for Idle (and
 * the word alone when there is no text). `forCard` uses the card's text,
 * which a level-0 status leaves alone.
 */
export function statusLine(status: SessionStatus, forCard = false): string {
  const text = forCard ? status.cardText : status.text
  const word = STATE_WORDS[status.state]
  if (word === null) return text
  return text.length > 0 ? `${word} · ${text}` : word
}

/**
 * The status text after one turn's events, from an idle start: what main
 * keeps as a session's last status text (D-12), outside every tree.
 */
export function statusTextAfterTurn(events: readonly StatusEvent[]): string {
  let status = initialStatus({ busy: false, lastStatus: null })
  for (const event of events) status = reduceStatus(status, { kind: 'event', event }, 0)
  return status.text
}

/**
 * Whether a change at `level` moves (jiggle, flash, the badge's arrival) under
 * the visibility threshold (D-15). Level 0 never moves; the threshold turns
 * off motion, never information.
 */
export function shouldAnimate(level: number, threshold: number): boolean {
  return level >= 1 && level >= threshold
}

// ---------------------------------------------------------------------------
// Attention (D-16, A-07, A-08)
// ---------------------------------------------------------------------------

/** What a session is asking the person to look at: its edge arrow's glyph and label. */
export type AttentionKind = 'done' | 'needs' | 'failed' | 'new'

export interface Attention {
  kind: AttentionKind
  level: number
}

/** A new chat or fork arrives like a level-2 Done (A-08). */
const NEW_LEVEL = 2
/** Done asks for an arrow from this level (D-14 levels table). */
const DONE_ATTENTION_LEVEL = 2

/**
 * What a session asks for until the person looks, or null. Needs you is
 * level 3 until a reply; Failed counts as level 2 (A-07); Done counts from
 * level 2; a just-created chat that is still Idle counts as a level-2
 * arrival (A-08). Working and a quiet Idle ask for nothing.
 */
export function attentionOf(status: SessionStatus, isNew: boolean): Attention | null {
  if (status.needs || status.state === 'needs') return { kind: 'needs', level: STATUS_LEVEL_CEILING }
  if (status.state === 'failed') return { kind: 'failed', level: FAILED_LEVEL }
  if (status.state === 'done') return status.level >= DONE_ATTENTION_LEVEL ? { kind: 'done', level: status.level } : null
  if (isNew && status.state === 'idle') return { kind: 'new', level: NEW_LEVEL }
  return null
}
