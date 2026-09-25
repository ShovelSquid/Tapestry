/**
 * AuthorsLegend — one row per author, with a swatch, the literal actor id, a
 * letter count, and (D-22, TA-07) a refused-change count for an agent that
 * tried to touch a letter it did not write.
 *
 * UI-SPEC "Authors legend" copy, verbatim:
 *  - person: "[swatch] user.[name] · [n] letters"
 *  - agent: "[swatch] agent.[name] · [n] letters"
 *  - observed: "[swatch] author unknown · [n] letters"
 *  - a refused agent: "… · [n] changes refused", tooltip "agent.[name] tried
 *    to change letters it didn't write. Nothing was saved."
 *  - underlay hint: "Hold Option to see who wrote what."
 *  - separate-authors toggle: "Show each author on its own line" /
 *    "Twist the authors back together" (D-23/L-2 — the drag's keyboard
 *    equal; `onToggleSeparateAuthors` is Plan 08 Task 3's own wiring, so
 *    this legend renders correctly with or without it supplied).
 *
 * A refusal never interrupts writing (TA-07): this legend is the *only*
 * visible trace of one, so it renders on its own schedule (the caller
 * refreshes `rows`), never as a popup or a modal.
 */

import React from 'react'
import { authorPattern, authorToken, type AuthorPattern } from './author-palette'

export interface AuthorLegendRow {
  /** The literal actor id (`user.kaelen`, `agent.claude`, `obsidian.bridge`, or `unknown`). */
  actorId: string
  /** Live letters currently attributed to this actor. */
  letterCount: number
  /** D-22 refusals this session (TA-07). Zero for a human, or an agent that has never been refused. */
  refusedCount: number
}

export interface AuthorsLegendProps {
  rows: readonly AuthorLegendRow[]
  orderedAgentNames: readonly string[]
  /** D-23/L-2: whether the separated (drag-apart-equivalent) view is
   * currently latched. Defaults to false when the caller has not wired
   * Task 3's own strand-separation state yet. */
  separated?: boolean
  onToggleSeparateAuthors?: () => void
}

function isHumanActorId(actorId: string): boolean {
  return actorId.startsWith('user.')
}

function isAgentActorId(actorId: string): boolean {
  return actorId.startsWith('agent.')
}

/** The label text for one row, matching UI-SPEC's per-kind copy exactly. */
function rowLabel(actorId: string): string {
  if (isHumanActorId(actorId)) return actorId
  if (isAgentActorId(actorId)) return actorId
  return 'author unknown'
}

const DASH_PATTERN_CSS: Record<AuthorPattern, string> = {
  solid: 'none',
  dotted: '2,2',
  dashed: '4,2',
  'long-dash': '8,2',
  'dash-dot': '6,2,1,2',
  double: '1,0',
  wavy: '1,2',
}

function Swatch({ token, pattern }: { token: string; pattern: AuthorPattern }): React.ReactElement {
  return (
    <svg width="20" height="12" aria-hidden="true" style={{ flexShrink: 0 }}>
      <line
        x1="0"
        y1="6"
        x2="20"
        y2="6"
        stroke={`var(${token})`}
        strokeWidth={pattern === 'double' ? 3 : 1.5}
        strokeDasharray={DASH_PATTERN_CSS[pattern]}
      />
    </svg>
  )
}

export default function AuthorsLegend({
  rows,
  orderedAgentNames,
  separated = false,
  onToggleSeparateAuthors,
}: AuthorsLegendProps): React.ReactElement {
  return (
    <section aria-label="Authors" style={styles.panel}>
      <h3 style={styles.heading}>Authors</h3>
      <ul style={styles.list}>
        {rows.map((row) => {
          const token = authorToken(row.actorId, orderedAgentNames)
          const pattern = authorPattern(row.actorId, orderedAgentNames)
          const refused = isAgentActorId(row.actorId) && row.refusedCount > 0
          return (
            <li key={row.actorId} style={styles.row}>
              <Swatch token={token} pattern={pattern} />
              <span style={styles.label}>
                {rowLabel(row.actorId)} · {row.letterCount} letter{row.letterCount === 1 ? '' : 's'}
                {refused && (
                  <span
                    title={`${row.actorId} tried to change letters it didn't write. Nothing was saved.`}
                    style={styles.refused}
                  >
                    {' '}
                    · {row.refusedCount} change{row.refusedCount === 1 ? '' : 's'} refused
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      <p style={styles.hint}>Hold Option to see who wrote what.</p>

      {onToggleSeparateAuthors && (
        <button type="button" onClick={onToggleSeparateAuthors} style={styles.toggleButton}>
          {separated ? 'Twist the authors back together' : 'Show each author on its own line'}
        </button>
      )}
    </section>
  )
}

// No hex literal at any use site in this file (UI-SPEC "Color": "Every value
// below is a named token... No component, stylesheet or shader in this
// phase may write a hex literal at a use site") -- every token here is
// declared in App.css's `:root`, so a bare `var(--token)` (no fallback
// value) is enough, unlike ThreadOverlay.tsx's own inline styles elsewhere.
const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'var(--tap-surface)',
    borderRadius: 8,
    padding: 16,
    minWidth: 240,
  },
  heading: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--tap-muted)',
    marginBottom: 8,
  },
  list: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 13,
    color: 'var(--tap-ink)',
  },
  refused: {
    color: 'var(--tap-destructive-text)',
  },
  hint: {
    fontSize: 13,
    color: 'var(--tap-muted)',
    marginTop: 12,
  },
  toggleButton: {
    marginTop: 8,
    fontSize: 13,
    border: '1px solid var(--tap-border)',
    borderRadius: 6,
    background: 'transparent',
    padding: '4px 10px',
    cursor: 'pointer',
  },
}
