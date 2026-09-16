/**
 * FrameHeader — the 64px band at the top of a tree's frame (UI-SPEC).
 *
 * Two rows: the tree's name, and beneath it what kind of tree it is followed
 * by its own status. The status lives here rather than in one corner of the
 * window because the space holds several trees at once: a single indicator
 * would have to average them, and "Saved" while another tree is still writing
 * is exactly the reassurance D-02 forbids.
 *
 * The header is also the frame's drag handle. Pointer events that started on a
 * button are left alone, so the Tree options button Plan 06 adds to the right
 * slot can be clicked without dragging the frame.
 */

import React from 'react'
import type { TreeSaveState } from '../state/use-forest'

interface FrameHeaderProps {
  name: string
  kind: 'native' | 'vault'
  saveState: TreeSaveState
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
}

/** What kind of tree this is, in the person's words rather than the code's. */
const kindLabels: Record<'native' | 'vault', string> = {
  native: 'Tapestry world',
  vault: 'Obsidian vault',
}

/** Carried from SaveIndicator: the three states a native tree can be in. */
const statusText: Record<TreeSaveState, string> = {
  saved: 'Saved',
  saving: 'Saving...',
  error: 'Not saved',
}

export default function FrameHeader({
  name,
  kind,
  saveState,
  onPointerDown,
}: FrameHeaderProps): React.ReactElement {
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // A click on a control is a click on that control, not a frame drag.
    if ((e.target as HTMLElement).closest('button')) return
    onPointerDown(e)
  }

  const status = statusText[saveState]

  return (
    <div className="tapestry-frame-header" onPointerDown={handlePointerDown}>
      <div className="tapestry-frame-header-row">
        <span className="tapestry-frame-name" title={name}>
          {name}
        </span>
        {/* Right-hand slot: Plan 06 puts the Tree options button here. */}
      </div>

      <div className="tapestry-frame-header-row">
        <span className="tapestry-frame-kind">{kindLabels[kind]}</span>
        <span
          className={
            saveState === 'error'
              ? 'tapestry-frame-status tapestry-frame-status--error'
              : 'tapestry-frame-status'
          }
          title={status}
        >
          {status}
        </span>
      </div>
    </div>
  )
}
