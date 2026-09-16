/**
 * AgentsPanel -- who may reach your trees, and what they have been doing
 * (UI-SPEC "Agents panel", D-03/D-06).
 *
 * A popover on the PassageChooser surface, opened from the forest bar. It is
 * the one place an agent is connected or removed, so it carries the two facts
 * that matter about each one: its literal actor id (`agent.claude` — the same
 * string that appears on every commit it signs) and whether it is connected
 * right now.
 *
 * Status is observed rather than announced, and it carries no spinner: the
 * panel simply shows what the socket last saw, and re-reads when the main
 * process says something changed.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Dialog from './Dialog'
import ConnectAgentDialog from './ConnectAgentDialog'

interface AgentsPanelProps {
  agents: TapestryAgentSummary[]
  enabled: boolean
  /** Re-read the list and the switch from main. */
  onRefresh: () => void
  onClose: () => void
}

/** Four-point spark: the same glyph the provenance badge uses for agents. */
function SparkGlyph(): React.ReactElement {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="currentColor"
      focusable="false"
      aria-hidden="true"
      className="tapestry-agent-glyph"
    >
      <path d="M8 1.4 9.5 6.5 14.6 8 9.5 9.5 8 14.6 6.5 9.5 1.4 8 6.5 6.5Z" />
    </svg>
  )
}

/** "Connected now" / "Last connected ..." / "Never connected". */
function statusLine(agent: TapestryAgentSummary): string {
  if (agent.connected) return 'Connected now'
  if (!agent.lastConnectedAt) return 'Never connected'
  const when = new Date(agent.lastConnectedAt)
  if (Number.isNaN(when.getTime())) return 'Never connected'
  return `Last connected ${when.toLocaleString()}`
}

export default function AgentsPanel({
  agents,
  enabled,
  onRefresh,
  onClose,
}: AgentsPanelProps): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)

  const [isConnecting, setIsConnecting] = useState(false)
  /** The agent awaiting a remove confirmation, if any. */
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  /** Which row's menu is open. */
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  // A dialog covers the panel and owns Escape while it is up, so the panel's
  // own dismissal must not fire underneath it.
  const dialogOpen = isConnecting || pendingRemoval !== null

  useEffect(() => {
    if (dialogOpen) return undefined

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (openMenu) {
          setOpenMenu(null)
          return
        }
        onClose()
      }
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (!panelRef.current?.contains(event.target as Node)) onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [dialogOpen, onClose, openMenu])

  const handleToggleEnabled = useCallback(async () => {
    await window.tapestry.agents.setEnabled(!enabled)
    onRefresh()
  }, [enabled, onRefresh])

  const handleRemove = useCallback(async () => {
    if (!pendingRemoval) return
    await window.tapestry.agents.remove(pendingRemoval)
    setPendingRemoval(null)
    onRefresh()
  }, [pendingRemoval, onRefresh])

  return (
    <div className="tapestry-agents-panel" ref={panelRef} role="dialog" aria-label="Agents">
      <h2 className="tapestry-agents-heading">Agents</h2>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        className="tapestry-agents-switch"
        onClick={handleToggleEnabled}
      >
        <span className="tapestry-agents-switch-track" aria-hidden="true">
          <span className="tapestry-agents-switch-thumb" />
        </span>
        Let agents connect
      </button>

      {!enabled && (
        <p className="tapestry-agents-body">
          Agents can&apos;t read or change your trees while this is off. Agents may still edit vault
          files directly while Tapestry is closed; those edits appear with their sign-in log
          entries.
        </p>
      )}

      {agents.length === 0 ? (
        <p className="tapestry-agents-body">
          No agents yet. Connect Claude, ChatGPT or another agent so it can read notes and grow new
          ones from them.
        </p>
      ) : (
        <ul className="tapestry-agents-list">
          {agents.map((agent) => {
            const actorId = `agent.${agent.name}`
            return (
              <li className="tapestry-agent-row" key={agent.name}>
                <SparkGlyph />

                <span className="tapestry-agent-text">
                  {/* The literal actor id, the same string its commits carry. */}
                  <span className="tapestry-agent-id" title={actorId}>
                    {actorId}
                  </span>
                  <span className="tapestry-agent-status">{statusLine(agent)}</span>
                </span>

                <span className="tapestry-agent-menu-wrap">
                  <button
                    type="button"
                    className="tapestry-agent-menu-button"
                    aria-label={`Options for ${actorId}`}
                    aria-haspopup="menu"
                    aria-expanded={openMenu === agent.name}
                    onClick={() => setOpenMenu(openMenu === agent.name ? null : agent.name)}
                  >
                    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
                      <circle cx="3" cy="8" r="1.4" />
                      <circle cx="8" cy="8" r="1.4" />
                      <circle cx="13" cy="8" r="1.4" />
                    </svg>
                  </button>

                  {openMenu === agent.name && (
                    <div className="tapestry-agent-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="tapestry-agent-menu-item"
                        onClick={() => {
                          setOpenMenu(null)
                          setPendingRemoval(agent.name)
                        }}
                      >
                        Remove agent
                      </button>
                    </div>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        className="tapestry-button--primary tapestry-agents-connect"
        onClick={() => setIsConnecting(true)}
      >
        Connect an agent
      </button>

      <p className="tapestry-agents-note">
        ChatGPT needs a secure tunnel and isn&apos;t set up yet.
      </p>

      {isConnecting && (
        <ConnectAgentDialog
          onClose={() => setIsConnecting(false)}
          onCreated={onRefresh}
        />
      )}

      {pendingRemoval && (
        <Dialog
          title={`Remove agent.${pendingRemoval}?`}
          // Escape keeps the agent: the safe answer is the default one.
          onDismiss={() => setPendingRemoval(null)}
          initialFocusRef={keepRef as React.RefObject<HTMLElement>}
          buttons={
            <>
              <button
                ref={keepRef}
                type="button"
                className="tapestry-button--secondary"
                onClick={() => setPendingRemoval(null)}
              >
                Keep agent
              </button>
              <button type="button" className="tapestry-button--destructive" onClick={handleRemove}>
                Remove agent
              </button>
            </>
          }
        >
          <p className="tapestry-dialog-text">
            It can no longer connect or write to your trees. Its past changes stay in history.
          </p>
        </Dialog>
      )}
    </div>
  )
}
