/**
 * PluginErrorNotification -- displays plugin crash notifications (D-34).
 *
 * Per UI-SPEC copywriting contract:
 * - Initial: "[Plugin name] stopped working. Restarting..."
 * - Restart failed: "[Plugin name] could not restart. Your work is safe."
 *   Actions: Restart / Dismiss
 *
 * The notification appears at the top of the viewport and auto-dismisses
 * after 3 seconds if the restart succeeds. If it fails, the user can
 * click Restart to try again or Dismiss to hide.
 */

import React, { useCallback, useEffect, useRef } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PluginErrorNotificationProps {
  pluginName: string
  message: string
  canRestart: boolean
  onRestart: (pluginName: string) => void
  onDismiss: () => void
}

// ---------------------------------------------------------------------------
// PluginErrorNotification
// ---------------------------------------------------------------------------

export default function PluginErrorNotification({
  pluginName,
  message,
  canRestart,
  onRestart,
  onDismiss,
}: PluginErrorNotificationProps): React.ReactElement {
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-dismiss after 3 seconds if restart succeeded (message is empty)
  useEffect(() => {
    if (!message) {
      autoDismissRef.current = setTimeout(onDismiss, 3000)
    }
    return () => {
      if (autoDismissRef.current) {
        clearTimeout(autoDismissRef.current)
      }
    }
  }, [message, onDismiss])

  const handleRestart = useCallback(() => {
    onRestart(pluginName)
  }, [pluginName, onRestart])

  // If message is empty, it means restart succeeded -- show brief success
  if (!message) {
    return (
      <div
        className="plugin-error-notification"
        style={{
          position: 'fixed',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10000,
          background: '#FFFFFF',
          border: '1px solid #E0DDD7',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 14,
          color: '#2C2C2C',
          maxWidth: 440,
        }}
      >
        <span>{pluginName} restarted successfully.</span>
      </div>
    )
  }

  return (
    <div
      className="plugin-error-notification"
      style={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        background: '#FFFFFF',
        border: '1px solid #E5484D',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 14,
        color: '#2C2C2C',
        maxWidth: 520,
      }}
    >
      {/* Error icon */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        style={{ flexShrink: 0 }}
      >
        <circle cx="10" cy="10" r="9" stroke="#E5484D" strokeWidth="2" />
        <line
          x1="10"
          y1="5"
          x2="10"
          y2="11"
          stroke="#E5484D"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="10" cy="14" r="1" fill="#E5484D" />
      </svg>

      <span style={{ flex: 1 }}>{message}</span>

      {canRestart && (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            onClick={handleRestart}
            style={{
              padding: '4px 12px',
              fontSize: 13,
              fontWeight: 600,
              background: '#4A7CFF',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Restart
          </button>
          <button
            onClick={onDismiss}
            style={{
              padding: '4px 12px',
              fontSize: 13,
              fontWeight: 500,
              background: 'transparent',
              color: '#666',
              border: '1px solid #E0DDD7',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
