/**
 * ProvenanceBadge -- a glyph plus the literal actor id, as written in the
 * `.tree` file (DRAW-04, D-06, D-07, D-21).
 *
 * Two rules from the UI-SPEC shape everything here:
 *
 * 1. **Never color-only.** Actors differ by glyph shape and by the id text,
 *    never by hue: all provenance is Muted --tap-muted, and the accent is never
 *    used for it. Someone who cannot tell the glyphs apart still reads
 *    `agent.claude` in full.
 * 2. **The literal id, always.** The badge shows what a person would find on
 *    the commit's `actor` line, so what the app says and what the file says
 *    are the same string. The only additions are for ids that would otherwise
 *    mislead: `obsidian.bridge` and `workspace.watcher` gain "author
 *    unknown" because an observed file change names the watcher, not whoever
 *    actually typed (02.2 D-21, 02.7 D-06).
 *
 * Glyphs are 16px inline SVG and `aria-hidden`; the text carries the meaning.
 */

import React from 'react'

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Actors that record what they saw on disk, never who wrote it. */
const OBSERVER_IDS = new Set(['obsidian.bridge', 'workspace.watcher'])

function isObserver(actor: TapestryActorRef): boolean {
  return actor.kind === 'plugin' && OBSERVER_IDS.has(actor.id)
}

/**
 * What the badge shows on screen.
 *
 * `local` is the pre-D-07 human id still present in existing history; it is
 * shown as written rather than rewritten to a name nobody recorded.
 */
export function actorBadgeText(actor: TapestryActorRef): string {
  if (actor.kind === 'system') {
    return 'system'
  }
  if (actor.kind === 'human' && actor.id === 'local') {
    return 'local'
  }
  if (actor.kind === 'plugin' && actor.id === 'obsidian.bridge') {
    return 'obsidian.bridge · author unknown'
  }
  if (actor.kind === 'plugin' && actor.id === 'workspace.watcher') {
    return 'workspace.watcher · author unknown'
  }
  return actor.id
}

/**
 * The same text for a screen reader. The middot is a visual separator; spoken
 * aloud it is noise, so the reading uses a comma instead.
 */
export function actorSpokenText(actor: TapestryActorRef): string {
  return actorBadgeText(actor).replace(' · author unknown', ', author unknown')
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

type GlyphKind = 'human' | 'agent' | 'observer' | 'plugin' | 'system'

function glyphKindFor(actor: TapestryActorRef): GlyphKind {
  if (actor.kind === 'system') return 'system'
  if (actor.kind === 'human') return 'human'
  if (actor.id.startsWith('agent.')) return 'agent'
  if (isObserver(actor)) return 'observer'
  return 'plugin'
}

/** 16px glyphs in currentColor, so they always match the badge text. */
function Glyph({ kind }: { kind: GlyphKind }): React.ReactElement {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'currentColor',
    focusable: 'false' as const,
  }

  switch (kind) {
    case 'human':
      // Person: circle head over rounded shoulders.
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="8" cy="5" r="2.6" />
          <path d="M2.8 14a5.2 5.2 0 0 1 10.4 0Z" />
        </svg>
      )
    case 'agent':
      // Four-point spark.
      return (
        <svg {...common} aria-hidden="true">
          <path d="M8 1.4 9.5 6.5 14.6 8 9.5 9.5 8 14.6 6.5 9.5 1.4 8 6.5 6.5Z" />
        </svg>
      )
    case 'observer':
      // Open eye outline: watched, not authored.
      return (
        <svg {...common} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M1.6 8S4.2 3.6 8 3.6 14.4 8 14.4 8 11.8 12.4 8 12.4 1.6 8 1.6 8Z" />
          <circle cx="8" cy="8" r="1.9" />
        </svg>
      )
    case 'plugin':
      // Puzzle piece.
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3.4 2.6h2.7a1.6 1.6 0 0 1 3.1 0h2.7a.9.9 0 0 1 .9.9v2.7a1.6 1.6 0 0 1 0 3.1v2.7a.9.9 0 0 1-.9.9H9.2a1.6 1.6 0 0 0-3.1 0H3.4a.9.9 0 0 1-.9-.9V9.2a1.6 1.6 0 0 0 0-3.1V3.5a.9.9 0 0 1 .9-.9Z" />
        </svg>
      )
    case 'system':
      // Gear, hollowed with the even-odd rule so it reads on any surface.
      return (
        <svg {...common} aria-hidden="true">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M7.1 1.5h1.8l.26 1.62c.42.13.81.3 1.17.53l1.36-.92 1.27 1.27-.92 1.36c.23.36.4.75.53 1.17l1.62.26v1.8l-1.62.26c-.13.42-.3.81-.53 1.17l.92 1.36-1.27 1.27-1.36-.92c-.36.23-.75.4-1.17.53L8.9 14.5H7.1l-.26-1.62a4.6 4.6 0 0 1-1.17-.53l-1.36.92-1.27-1.27.92-1.36a4.6 4.6 0 0 1-.53-1.17L1.5 8.9V7.1l1.93-.26c.13-.42.3-.81.53-1.17l-.92-1.36 1.27-1.27 1.36.92c.36-.23.75-.4 1.17-.53ZM8 6.1a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z"
          />
        </svg>
      )
  }
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

/**
 * Glyph + 4px + the actor id. The text truncates with an ellipsis at the
 * card's inner width; the caller keeps the full id in the footer's tooltip and
 * accessible name, so a long agent name is never the only copy on screen.
 */
export default function ProvenanceBadge({
  actor,
}: {
  actor: TapestryActorRef
}): React.ReactElement {
  return (
    <span className="tapestry-provenance-badge">
      <Glyph kind={glyphKindFor(actor)} />
      <span className="tapestry-provenance-badge-text">{actorBadgeText(actor)}</span>
    </span>
  )
}
