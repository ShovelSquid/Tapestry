/**
 * SaveIndicator — displays the current file name and save state in the
 * top-left corner per D-02 and D-05.
 *
 * Three states:
 *   - "Saved" (neutral, 13px/400)
 *   - "Saving..." (neutral, 13px/400)
 *   - "Not saved" (destructive #E5484D, 13px/400)
 *
 * The file name is truncated at 200px with ellipsis and full path in tooltip.
 * Never implies unsaved text was saved (D-02).
 */

import React from 'react'

// path.basename polyfill for the renderer (no Node.js in sandbox)
function getFileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

type SaveState = 'saved' | 'saving' | 'error'

interface SaveIndicatorProps {
  filePath: string | null
  saveState: SaveState
}

const stateText: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving...',
  error: 'Not saved',
}

const stateClass: Record<SaveState, string> = {
  saved: 'tapestry-save-state tapestry-save-state--saved',
  saving: 'tapestry-save-state tapestry-save-state--saving',
  error: 'tapestry-save-state tapestry-save-state--error',
}

export default function SaveIndicator({
  filePath,
  saveState,
}: SaveIndicatorProps): React.ReactElement | null {
  if (!filePath) return null

  const fileName = getFileName(filePath)

  return (
    <div className="tapestry-save-indicator">
      <span className="tapestry-file-name" title={filePath}>
        {fileName}
      </span>
      <span className={stateClass[saveState]}>{stateText[saveState]}</span>
    </div>
  )
}
