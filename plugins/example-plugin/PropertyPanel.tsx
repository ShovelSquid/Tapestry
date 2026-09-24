/**
 * ExamplePropertyPanel — a React component demonstrating custom UI
 * contribution from a third-party plugin.
 *
 * Receives the selected node's properties and renders them in a styled
 * list. This component shows how a plugin can provide custom UI without
 * modifying the host or rebuilding the core (PLUG-01, D-27).
 *
 * NOTE: This file imports ONLY from the SDK package. It does NOT import
 * from Electron, the host app, or Node.js built-ins (PLUG-03).
 */

import type { NodeData } from '@tapestry/sdk'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExamplePropertyPanelProps {
  node: NodeData
}

// ---------------------------------------------------------------------------
// ExamplePropertyPanel
// ---------------------------------------------------------------------------

/**
 * Renders a readable list of all properties on the selected node.
 * Each property shows its key, type tag, and formatted value.
 */
function ExamplePropertyPanel({ node }: ExamplePropertyPanelProps) {
  const entries = Object.entries(node.props)

  return (
    <div
      style={{
        padding: '12px',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: '13px',
        color: '#2C2C2C',
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: '14px',
          marginBottom: '8px',
          paddingBottom: '6px',
          borderBottom: '1px solid #E0DDD7',
        }}
      >
        Properties ({entries.length})
      </div>

      {entries.map(([key, prop]) => (
        <div
          key={key}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 0',
            borderBottom: '1px solid #F5F5F5',
          }}
        >
          <span style={{ fontWeight: 500, color: '#555' }}>{key}</span>
          <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#777' }}>
            [{prop.type}] {String(prop.value)}
          </span>
        </div>
      ))}

      {entries.length === 0 && (
        <div
          style={{
            color: '#999',
            fontStyle: 'italic',
            padding: '8px 0',
          }}
        >
          No properties
        </div>
      )}
    </div>
  )
}

export default ExamplePropertyPanel
export type { ExamplePropertyPanelProps }
