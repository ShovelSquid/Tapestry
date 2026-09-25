/**
 * MarkerList -- one row per marker in a session, in time order (UI-SPEC
 * "Marker meaning without the stage"): "[marker label] · [time]", focusable
 * and `Enter`-activatable to open that moment. This is route 2 of the two
 * routes marker meaning is carried by (route 1 is `,`/`.` stepping while the
 * stage has focus, `stage/markers.ts`'s `attachMarkerNav`) -- neither route
 * is a hover, and this route is the one a machine with no WebGL relies on
 * entirely (`StageFallbackPanel.tsx` mounts `SessionList`, which mounts
 * this for every session).
 *
 * Reuses `stage/markers.ts`'s own `markerLabel` so a marker reads identically
 * here, in the stage's hover chip, and in the `,`/`.` announcement -- one
 * source of truth for the text, never re-derived.
 */

import React from 'react'
import { markerLabel } from './stage/markers'
import type { SessionMarker } from '../../shared/threads/sessions'

export interface MarkerListProps {
  markers: readonly SessionMarker[]
  onOpen: (marker: SessionMarker) => void
}

export default function MarkerList({ markers, onOpen }: MarkerListProps): React.ReactElement {
  if (markers.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--tap-muted)', margin: '4px 0 4px 24px' }}>
        No markers in this session.
      </p>
    )
  }

  return (
    <ul style={{ listStyle: 'none', margin: '4px 0 4px 24px', padding: 0 }}>
      {markers.map((marker, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => onOpen(marker)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              fontSize: 13,
              padding: '4px 8px',
              border: 'none',
              borderRadius: 4,
              background: 'transparent',
              color: 'var(--tap-ink)',
              cursor: 'pointer',
            }}
          >
            {markerLabel(marker)}
          </button>
        </li>
      ))}
    </ul>
  )
}
