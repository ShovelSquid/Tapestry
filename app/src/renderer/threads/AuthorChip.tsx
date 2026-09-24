/**
 * AuthorChip — the hover chip naming a letter or strand's literal actor id
 * (D-21: "hovering shows the literal actor id, for example `agent.claude`").
 *
 * Colour is never the only cue (DRAW-04): this chip is the words that go
 * with the swatch, wherever hovering a run of text or a strand reveals
 * authorship (`use-thread-editor.ts`'s typer decorations, the stage's
 * hover handling). Positioned absolutely by the caller, on the
 * PassageChooser surface per UI-SPEC "Agents writing live".
 */

import React from 'react'
import { authorToken } from './author-palette'

export interface AuthorChipProps {
  actorId: string
  x: number
  y: number
  orderedAgentNames: readonly string[]
}

export default function AuthorChip({ actorId, x, y, orderedAgentNames }: AuthorChipProps): React.ReactElement {
  const token = authorToken(actorId, orderedAgentNames)
  return (
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        transform: 'translate(-50%, -100%)',
        padding: '4px 8px',
        borderRadius: 6,
        fontSize: 13,
        lineHeight: 1.4,
        background: 'var(--tap-surface, #FFFFFF)',
        border: `1px solid var(${token})`,
        color: 'var(--tap-ink, #2C2C2C)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        pointerEvents: 'none',
        zIndex: 1100,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: `var(${token})`,
          marginRight: 6,
        }}
      />
      {actorId}
    </div>
  )
}
