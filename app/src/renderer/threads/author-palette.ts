/**
 * Author colour/pattern assignment (D-21, UI-SPEC "Author identity").
 *
 * **Colour is a display mapping, never data** (UI-SPEC "Two colour
 * channels"): nothing exported here is ever written to `.tree`. Kaelen
 * (`user.*` — `commands/actor.ts`'s `humanActor`, kind `human`, id prefix
 * `user.`) always reads as the self token; an agent (`agent.<name>`) is
 * assigned a palette slot in the order it was **first connected** — the
 * Agents panel's own `agents:list` `createdAt` ordering (02.2) — cycling
 * past the fifth; anything else (an observed edit, an unrecognized actor
 * kind, or an agent this renderer has never heard of) reads as
 * `--tap-author-unknown`, never a colour a real author could be mistaken
 * for.
 *
 * Pure, DOM-free: every function here is a plain string→string/number
 * mapping, so the stage (`stage/strands.ts`, `stage/glyphs.ts`), the typer's
 * underlay decorations (`use-thread-editor.ts`) and `AuthorsLegend.tsx` all
 * agree on exactly one assignment, computed once from the same agent list.
 */

export type AuthorToken =
  | '--tap-author-self'
  | '--tap-author-1'
  | '--tap-author-2'
  | '--tap-author-3'
  | '--tap-author-4'
  | '--tap-author-5'
  | '--tap-author-unknown'

/**
 * UI-SPEC "Author identity": the per-author non-colour cue, carried on the
 * typer's underline and the stage strand's dash pattern alike (DRAW-04 —
 * colour is never the only cue). Distinct shapes answer "which author" the
 * same way in two different places.
 */
export type AuthorPattern = 'solid' | 'dotted' | 'dashed' | 'long-dash' | 'dash-dot' | 'double' | 'wavy'

const AGENT_TOKENS: readonly AuthorToken[] = [
  '--tap-author-1',
  '--tap-author-2',
  '--tap-author-3',
  '--tap-author-4',
  '--tap-author-5',
]

const AGENT_PATTERNS: readonly AuthorPattern[] = ['dotted', 'dashed', 'long-dash', 'dash-dot', 'double']

/** 0 (self) + 5 agent slots + 1 (unknown) = the `aActor` attribute's range. */
export const AUTHOR_PALETTE_SIZE = AGENT_TOKENS.length + 2

/**
 * Agent names in the order they were first connected (`createdAt` ascending)
 * — the order palette slots are assigned in (UI-SPEC: "in palette order at
 * connect time"). Ties (equal `createdAt`, which `agents:create` cannot
 * actually produce — each write reads the file first) break by name so the
 * result is still deterministic.
 */
export function orderAgentsByConnection(agents: readonly { name: string; createdAt: string }[]): string[] {
  return [...agents]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
    .map((a) => a.name)
}

/** `commands/actor.ts`'s `humanActor` stamps `human user.<name>`: the kind
 * is `human`, but the id itself (the only thing this pure display module
 * ever sees) carries the `user.` prefix. */
function isHumanActor(actorId: string): boolean {
  return actorId.startsWith('user.')
}

/** The bare agent name from an `agent.<name>` actor id, or null for anything else. */
function agentNameOf(actorId: string): string | null {
  return actorId.startsWith('agent.') ? actorId.slice('agent.'.length) : null
}

/** The display token for `actorId`, given the agents' own connection order. */
export function authorToken(actorId: string, orderedAgentNames: readonly string[]): AuthorToken {
  if (isHumanActor(actorId)) return '--tap-author-self'
  const agentName = agentNameOf(actorId)
  if (agentName !== null) {
    const index = orderedAgentNames.indexOf(agentName)
    if (index !== -1) return AGENT_TOKENS[index % AGENT_TOKENS.length]
  }
  return '--tap-author-unknown'
}

/** The non-colour cue for `actorId` (UI-SPEC's underline/dash pattern table). */
export function authorPattern(actorId: string, orderedAgentNames: readonly string[]): AuthorPattern {
  if (isHumanActor(actorId)) return 'solid'
  const agentName = agentNameOf(actorId)
  if (agentName !== null) {
    const index = orderedAgentNames.indexOf(agentName)
    if (index !== -1) return AGENT_PATTERNS[index % AGENT_PATTERNS.length]
  }
  return 'wavy'
}

/**
 * A 0-based GPU-friendly author index for `actorId`: 0 is always the person,
 * 1-5 are agents in connection order (cycling past the fifth), 6 is
 * unknown. Feeds the stage's `aActor` instance attribute (`stage/glyphs.ts`)
 * and a shader colour-array uniform indexed the identical way — the index
 * and `authorToken`'s CSS token always name the same slot.
 */
export function authorPaletteIndex(actorId: string, orderedAgentNames: readonly string[]): number {
  if (isHumanActor(actorId)) return 0
  const agentName = agentNameOf(actorId)
  if (agentName !== null) {
    const index = orderedAgentNames.indexOf(agentName)
    if (index !== -1) return 1 + (index % AGENT_TOKENS.length)
  }
  return AGENT_TOKENS.length + 1
}
