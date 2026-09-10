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

  return {
    type: 'div',
    props: {
      style: {
        padding: '12px',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: '13px',
        color: '#2C2C2C',
      },
      children: [
        // Header
        {
          type: 'div',
          props: {
            key: 'header',
            style: {
              fontWeight: 600,
              fontSize: '14px',
              marginBottom: '8px',
              paddingBottom: '6px',
              borderBottom: '1px solid #E0DDD7',
            },
            children: `Properties (${entries.length})`,
          },
        },
        // Property list
        ...entries.map(([key, prop]) => ({
          type: 'div',
          props: {
            key,
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 0',
              borderBottom: '1px solid #F5F5F5',
            },
            children: [
              // Key
              {
                type: 'span',
                props: {
                  key: 'k',
                  style: { fontWeight: 500, color: '#555' },
                  children: key,
                },
              },
              // Type tag + value
              {
                type: 'span',
                props: {
                  key: 'v',
                  style: { fontFamily: 'monospace', fontSize: '12px', color: '#777' },
                  children: `[${prop.type}] ${String(prop.value)}`,
                },
              },
            ],
          },
        })),
        // Empty state
        ...(entries.length === 0
          ? [
              {
                type: 'div',
                props: {
                  key: 'empty',
                  style: {
                    color: '#999',
                    fontStyle: 'italic',
                    padding: '8px 0',
                  },
                  children: 'No properties',
                },
              },
            ]
          : []),
      ],
    },
  }
}

export default ExamplePropertyPanel
export type { ExamplePropertyPanelProps }
