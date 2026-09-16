/**
 * Locks: whether an agent may change one aspect of a note (02.4).
 *
 * The rule is **allow by default, deny if locked** (02.4 D-01). Authorship is
 * no longer the gate; it supplies only the *default* lock owner. An agent may
 * write an aspect when the aspect resolves open, when the agent is the lock's
 * owner, or when the agent is on the lock's allow list (D-09). Only agent
 * actors are checked. People and non-agent plugins pass.
 *
 * Two aspects exist in this slice:
 * - `text`: the note's body and its title (D-03; there is no title lock).
 * - `delete`: removing the note from the world (D-02).
 *
 * A lock is either explicit or a default:
 * - **Explicit** (D-08): a `lock.<aspect>` property whose `text` value is the
 *   owner's actor id, or the literal `open`. It always overrides the default.
 *   A malformed value fails closed: any type other than `text` is locked, and
 *   only the exact, case-sensitive `open` unlocks.
 * - **Default** (D-04, 02.4 D-05, D-06): derived at check time from the actor on
 *   the commit that created the note, and **never written to the file**. A
 *   note not created by an agent starts locked to its creator. A note created
 *   by an agent starts open to agents, per AGENT_NOTES_OPEN_TO_AGENTS.
 *
 * This module only reads. It never submits, and nothing in production writes
 * `lock.*` properties yet: the key names are Decision Register #19, a one-way
 * door that has not been answered. Only test fixtures write them.
 *
 * It is pure on purpose: it takes property maps and actor pairs, touches no
 * bridge, and has only type imports, so its rules are testable without the
 * native addon and `notes.ts` can import it without a cycle.
 */

import type { NodeData } from '../kernel-bridge'

// ---------------------------------------------------------------------------
// Aspects and policy constants
// ---------------------------------------------------------------------------

/** What a lock protects. `layout` and `rank` are deferred. */
export type LockAspect = 'text' | 'delete'

/**
 * Whether deleting a note that no agent created starts locked (02.4 D-05).
 *
 * Kaelen said deletion is a lockable aspect but not whether it starts locked.
 * The conservative reading, approved under the standing grant, is locked.
 * Flipping it is a one-line change; tests import it and follow its value.
 */
// PENDING (Decision Register #1 residual)
export const NON_AGENT_NOTES_DELETE_LOCKED = true

/**
 * Whether a note an agent created starts open to every agent (02.4 D-06).
 *
 * With `false`, an agent's note is locked to the agent that created it, which
 * is the superseded 02.2 D-05 behaviour for agent notes.
 */
// PENDING (Decision Register)
export const AGENT_NOTES_OPEN_TO_AGENTS = true

/** The only value of an explicit lock that unlocks its aspect (D-08). */
export const LOCK_OPEN = 'open'

/** Shown in a refusal when a lock's owner is empty or only whitespace. */
export const UNKNOWN_LOCK_OWNER = '(unknown)'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * An actor pair as either side sees it. `Actor` (whose kind is `ActorKind`)
 * and the journal's `ActorRef` (whose kind is plain `string`) both satisfy it.
 */
export interface ActorLike {
  readonly kind: string
  readonly id: string
}

/** The two defaults, as a parameter so tests can exercise both values. */
export interface LockPolicy {
  readonly agentNotesOpenToAgents: boolean
  readonly nonAgentNotesDeleteLocked: boolean
}

/** The policy the application runs with, built from the constants above. */
export const DEFAULT_LOCK_POLICY: LockPolicy = Object.freeze({
  agentNotesOpenToAgents: AGENT_NOTES_OPEN_TO_AGENTS,
  nonAgentNotesDeleteLocked: NON_AGENT_NOTES_DELETE_LOCKED,
})

/** A note's property map, exactly as the bridge returns it. */
export type LockProps = NodeData['props']

/**
 * How one aspect of one note resolves.
 *
 * `ownerKind` is set only on a default lock, which belongs to the creator's
 * kind and id together, as the retired 02.2 D-05 gate compared them. An
 * explicit `lock.<aspect>` owner is id-only text (D-08) and has no kind.
 */
export type LockState =
  | { locked: false }
  | { locked: true; owner: string; ownerKind?: string; allow: readonly string[] }

// ---------------------------------------------------------------------------
// Keys and actors
// ---------------------------------------------------------------------------

/** The property holding an aspect's explicit lock. Read only. */
export function lockKey(aspect: LockAspect): string {
  return `lock.${aspect}`
}

/** The property holding an aspect's allow list. Read only. */
export function allowKey(aspect: LockAspect): string {
  return `lock.${aspect}.allow`
}

/**
 * Whether an actor is an agent, and therefore subject to locks (D-10).
 *
 * Agents are plugins whose host-stamped id starts with `agent.`. A person
 * editing their world is not checked, and a bridge plugin recording what a
 * file already says is not either.
 */
export function isAgentActor(actor: ActorLike): boolean {
  return actor.kind === 'plugin' && actor.id.startsWith('agent.')
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve one aspect of a note to open or locked-with-owner.
 *
 * An explicit `lock.<aspect>` wins (D-08) and fails closed: a value of any
 * type other than `text` is locked with its raw value as owner, only the
 * exact text `open` unlocks, and any other text, including an empty one, is
 * the owner. Without one, the default is derived from the note's creator
 * (D-04, 02.4 D-05, D-06); it is never written back.
 *
 * A locked aspect also carries its allow list (D-09), read from
 * `lock.<aspect>.allow` whether the lock is explicit or a default: the
 * agents named there may write despite the lock. The list is whitespace-
 * separated actor ids. Only a `text` value is read; any other type fails
 * closed to an empty list, which can only refuse more, never less. An open
 * aspect ignores the list.
 */
export function resolveLock(
  props: LockProps,
  createdBy: ActorLike,
  aspect: LockAspect,
  policy: LockPolicy = DEFAULT_LOCK_POLICY,
): LockState {
  const explicit = props[lockKey(aspect)]
  if (explicit) {
    if (explicit.type === 'text' && explicit.value === LOCK_OPEN) return { locked: false }
    return { locked: true, owner: String(explicit.value), allow: readAllow(props, aspect) }
  }

  const lockedToCreator: LockState = {
    locked: true,
    owner: createdBy.id,
    ownerKind: createdBy.kind,
    allow: readAllow(props, aspect),
  }

  if (isAgentActor(createdBy)) {
    return policy.agentNotesOpenToAgents ? { locked: false } : lockedToCreator
  }

  if (aspect === 'delete' && !policy.nonAgentNotesDeleteLocked) return { locked: false }
  return lockedToCreator
}

/**
 * The agents an aspect's allow list names (D-09). Only a `text` value is
 * read; anything else admits nobody.
 */
function readAllow(props: LockProps, aspect: LockAspect): string[] {
  const prop = props[allowKey(aspect)]
  if (!prop || prop.type !== 'text') return []
  return String(prop.value)
    .trim()
    .split(/\s+/)
    .filter((id) => id !== '')
}

/**
 * The refusal text for `actor` writing `aspect` of `noteId`, or null when the
 * write may proceed.
 *
 * Only agents are checked (D-10). An agent may write when the aspect is open,
 * when it is the lock's owner, or when it is on the allow list. Owner and
 * allow entries are compared with the actor id exactly; a default lock's
 * owner must also match on kind, so a non-agent creator whose id reads like
 * an agent's never hands its lock to that agent (WR-01). The refusal reads
 * `<note> <aspect> is locked by <owner>` (D-12), with a blank owner shown as
 * UNKNOWN_LOCK_OWNER so the message stays readable.
 */
export function checkLock(
  noteId: string,
  props: LockProps,
  createdBy: ActorLike,
  actor: ActorLike,
  aspect: LockAspect,
  policy: LockPolicy = DEFAULT_LOCK_POLICY,
): string | null {
  if (!isAgentActor(actor)) return null

  const state = resolveLock(props, createdBy, aspect, policy)
  if (!state.locked) return null
  const ownerMatches =
    state.owner === actor.id && (state.ownerKind === undefined || state.ownerKind === actor.kind)
  if (ownerMatches || state.allow.includes(actor.id)) return null

  const display = state.owner.trim() === '' ? UNKNOWN_LOCK_OWNER : state.owner
  return `${noteId} ${aspect} is locked by ${display}`
}
