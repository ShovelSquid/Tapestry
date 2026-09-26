/**
 * SelectionBar — what is selected, when it is more than one note.
 *
 * A strip at the top of the space: the count, one chip per note (its title,
 * which flies the camera to it, and a × that takes it out of the selection),
 * and Clear. One selected note needs no bar; its own blue outline says it.
 */

import React from 'react'
import type { ForestTree, NodeRef } from '../state/use-forest'
import { nodeKey } from '../state/use-forest'

/** Chips shown before the rest are summed up as "+N more". */
const MAX_CHIPS = 8

interface SelectionBarProps {
  selected: NodeRef[]
  trees: ForestTree[]
  onGoTo: (ref: NodeRef) => void
  onDeselect: (ref: NodeRef) => void
  onClear: () => void
}

function titleOf(trees: ForestTree[], ref: NodeRef): string {
  const node = trees.find((t) => t.id === ref.treeId)?.nodes.find((n) => n.id === ref.nodeId)
  const title = String(node?.props['title']?.value ?? '').trim()
  return title.length > 0 ? title : 'Untitled'
}

export default function SelectionBar({
  selected,
  trees,
  onGoTo,
  onDeselect,
  onClear,
}: SelectionBarProps): React.ReactElement | null {
  if (selected.length < 2) return null
  const shown = selected.slice(0, MAX_CHIPS)
  const rest = selected.length - shown.length

  return (
    <div className="tapestry-selection-bar" role="toolbar" aria-label="Selected notes">
      <span className="tapestry-selection-count">{selected.length} notes selected</span>
      {shown.map((ref) => {
        const title = titleOf(trees, ref)
        return (
          <span key={nodeKey(ref)} className="tapestry-selection-chip">
            <button
              type="button"
              className="tapestry-selection-chip-title"
              title={`Go to ${title}`}
              onClick={() => onGoTo(ref)}
            >
              {title}
            </button>
            <button
              type="button"
              className="tapestry-selection-chip-remove"
              aria-label={`Deselect ${title}`}
              onClick={() => onDeselect(ref)}
            >
              ×
            </button>
          </span>
        )
      })}
      {rest > 0 && <span className="tapestry-selection-more">+{rest} more</span>}
      <button type="button" className="tapestry-forest-button" onClick={onClear}>
        Clear
      </button>
    </div>
  )
}
