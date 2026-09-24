/**
 * Actor stamping — who a durable change is recorded as.
 *
 * Every commit carries an `actor <kind> <id>` line in the `.tree` journal.
 * That line is what the writing process claimed (FORMAT.md, "Integrity, not
 * authenticity"), so its honesty depends entirely on who gets to choose it.
 * The rule for the whole application: **the Electron main process chooses,
 * never the caller.**
 *
 * - The renderer sends no actor at all; `kernel:submit` takes (message, ops)
 *   and main supplies `human user.<name>` (D-07).
 * - A plugin's `context.kernel.submit` is bound to `plugin <pluginId>`
 *   whatever actor pair it passes, and is refused outright if it claims
 *   `human` or `system` (D-06).
 * - Agents are plugins with an id the host derives from their token:
 *   `plugin agent.<name>`.
 *
 * Stamping is policy, not a sandbox. Plugins are require()d into the main
 * process and could load the addon directly; real isolation is a later phase.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The kernel accepts exactly these three kinds (tapestry/kernel/Ops.hpp). */
export type ActorKind = 'human' | 'plugin' | 'system'

/** A resolved actor: the pair written to the journal's `actor` line. */
export interface Actor {
  readonly kind: ActorKind
  readonly id: string
}

// ---------------------------------------------------------------------------
// Name rule
// ---------------------------------------------------------------------------

/**
 * A user or agent name: lowercase letters, digits, `-` and `_`, 1 to 32
 * characters, starting with a letter or digit.
 *
 * This is deliberately **stricter than the kernel's token rule**, which
 * allows any non-space, non-control bytes including all of UTF-8. The kernel
 * cares about parsing the file; this rule cares about reading it. An actor id
 * is the part of a commit line a person scans by eye, so it stays in a shape
 * that is unambiguous in every editor, terminal and diff — no mixed scripts,
 * no case-folding surprises, no zero-width characters.
 *
 * The prefixed forms (`user.kaelen`, `agent.claude`) add a dot, which the
 * kernel allows inside a single token.
 */
export const ACTOR_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** Whether `name` is usable as the `<name>` half of an actor id. */
export function isValidActorName(name: unknown): name is string {
  return typeof name === 'string' && ACTOR_NAME_RE.test(name)
}

/** The message shown whenever a name fails ACTOR_NAME_RE. */
const INVALID_NAME_MESSAGE = 'User name must match ^[a-z0-9][a-z0-9_-]{0,31}$'

// ---------------------------------------------------------------------------
// Actor constructors
// ---------------------------------------------------------------------------

/**
 * The human actor for a stored user name: `human user.<userName>` (D-07).
 * Replaces the old `human local`; `local` lines stay valid history.
 */
export function humanActor(userName: string): Actor {
  if (!isValidActorName(userName)) {
    throw new Error(INVALID_NAME_MESSAGE)
  }
  return { kind: 'human', id: `user.${userName}` }
}

/**
 * The actor for a connected agent: `plugin agent.<agentName>` (D-06).
 * Agents are plugins as far as the journal is concerned; the `agent.` prefix
 * is what distinguishes them, which is why plugins may not claim it.
 */
export function agentActor(agentName: string): Actor {
  if (!isValidActorName(agentName)) {
    throw new Error(INVALID_NAME_MESSAGE)
  }
  return { kind: 'plugin', id: `agent.${agentName}` }
}

/**
 * Namespaces a plugin may not occupy, because the host stamps them itself:
 * agents, humans, and the Obsidian bridge.
 */
export const RESERVED_PLUGIN_ID_PREFIXES: readonly string[] = Object.freeze([
  'agent.',
  'user.',
  'obsidian.',
  'workspace.',
])

/** Reserved exactly: the id the host uses for its own system commits. */
const RESERVED_PLUGIN_IDS: readonly string[] = Object.freeze(['tapestry'])

/**
 * The actor for a plugin: `plugin <pluginId>`, where pluginId is the
 * plugin's directory name under plugins/.
 *
 * Throws for reserved ids so a plugin directory named `agent.claude` cannot
 * impersonate a connected agent. Ordinary ids (`tapestry-notes`,
 * `example-plugin`) are unaffected — the check is on the `tapestry.` style
 * prefixes and the bare `tapestry` id, not on the substring.
 */
export function pluginActor(pluginId: string): Actor {
  const reserved =
    RESERVED_PLUGIN_ID_PREFIXES.some((prefix) => pluginId.startsWith(prefix)) ||
    RESERVED_PLUGIN_IDS.includes(pluginId)
  if (reserved) {
    throw new Error(`Reserved plugin id: ${pluginId}`)
  }
  return { kind: 'plugin', id: pluginId }
}

// ---------------------------------------------------------------------------
// Fixed actors
// ---------------------------------------------------------------------------

/** Changes the Obsidian bridge observed in the vault but cannot attribute. */
export const OBSIDIAN_BRIDGE_ACTOR: Actor = Object.freeze({
  kind: 'plugin',
  id: 'obsidian.bridge',
} as const)

/** Changes a workspace mirror observed on disk but cannot attribute (02.7 D-06). */
export const WORKSPACE_BRIDGE_ACTOR: Actor = Object.freeze({
  kind: 'plugin',
  id: 'workspace.bridge',
} as const)

/** Tapestry's own recorded events (plugin enabled/disabled, crashes). */
export const SYSTEM_ACTOR: Actor = Object.freeze({
  kind: 'system',
  id: 'tapestry',
} as const)

// ---------------------------------------------------------------------------
// Plugin submit guard
// ---------------------------------------------------------------------------

/**
 * Refuse a plugin's attempt to commit as a person or as Tapestry itself.
 *
 * The host ignores the actor pair a plugin passes and stamps its own, so it
 * could silently re-stamp `human` too. Throwing instead makes a misbehaving
 * plugin visible rather than quietly corrected.
 */
export function assertPluginSubmitKind(kind: unknown): void {
  if (kind === 'human' || kind === 'system') {
    throw new Error('Plugins cannot commit as human or system')
  }
}
