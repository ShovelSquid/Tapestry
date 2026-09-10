/**
 * PassageChooser -- disambiguation popup for overlapping passages (D-15).
 *
 * When the user clicks in a region where multiple passages overlap, this
 * component presents a small list of the overlapping passages sorted by
 * span length so the user can choose which thread to follow or highlight.
 */

import React from 'react'

interface PassageInfo {
  anchorId: string
  text: string
  spanLength: number
}

interface PassageChooserProps {
  passages: PassageInfo[]
  x: number
  y: number
  onSelect: (anchorId: string) => void
  onDismiss: () => void
}

export default function PassageChooser({
  passages,
  x,
  y,
  onSelect,
  onDismiss,
}: PassageChooserProps): React.ReactElement {
  const sorted = [...passages].sort((a, b) => a.spanLength - b.spanLength)

  return (
    <div
      className="passage-chooser"
      style={{ position: 'fixed', left: x, top: y }}
      onMouseLeave={() => setTimeout(onDismiss, 300)}
    >
      <div className="passage-chooser-header">Select passage</div>
      {sorted.map((p) => (
        <button
          key={p.anchorId}
          className="passage-chooser-item"
          onClick={() => onSelect(p.anchorId)}
        >
          <span className="passage-chooser-text">
            {p.text.length > 40 ? p.text.slice(0, 40) + '…' : p.text}
          </span>
        </button>
      ))}
    </div>
  )
}
