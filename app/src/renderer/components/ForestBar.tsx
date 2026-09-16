/**
 * ForestBar -- the top-left chrome (UI-SPEC "Forest bar").
 *
 * It replaces the standalone SaveIndicator position and contains it, so the
 * corner holds one row rather than several things each claiming 16px. Plan 05
 * moves the save states into per-frame headers; until then the indicator rides
 * along here.
 *
 * Two controls: the Agents button, whose label is itself the bridge's status,
 * and the name button, which shows the actor id every change of Kaelen's is
 * signed with — clicking it opens the same dialog the first run used.
 */

import React, { useCallback, useRef, useState } from 'react'
import SaveIndicator from './SaveIndicator'
import AgentsPanel from './AgentsPanel'
import NamePromptDialog from './NamePromptDialog'

type SaveState = 'saved' | 'saving' | 'error'

interface ForestBarProps {
  filePath: string | null
  saveState: SaveState
  agents: TapestryAgentSummary[]
  agentsEnabled: boolean
  /** Null while the first-run prompt is still up. */
  userName: string | null
  /** Resolves to an error message to display, or null on success. */
  onSaveUserName: (name: string) => Promise<string | null>
  onAgentsRefresh: () => void
}

/**
 * The Agents button's label, which doubles as the bridge's status.
 *
 * "Agents off" is deliberately distinct from "Agents": with the switch off no
 * socket exists at all, and a label that read the same either way would hide
 * the difference between "nobody is connected" and "nobody can connect".
 */
function agentsButtonText(enabled: boolean, agents: TapestryAgentSummary[]): string {
  if (!enabled) return 'Agents off'
  const connected = agents.filter((agent) => agent.connected).length
  if (connected === 0) return 'Agents'
  if (connected === 1) return 'Agents · 1 connected'
  return `Agents · ${connected} connected`
}

export default function ForestBar({
  filePath,
  saveState,
  agents,
  agentsEnabled,
  userName,
  onSaveUserName,
  onAgentsRefresh,
}: ForestBarProps): React.ReactElement {
  const [isAgentsOpen, setIsAgentsOpen] = useState(false)
  const [isNameOpen, setIsNameOpen] = useState(false)
  const agentsButtonRef = useRef<HTMLButtonElement>(null)

  const handleSaveName = useCallback(
    async (name: string): Promise<string | null> => {
      const error = await onSaveUserName(name)
      if (!error) setIsNameOpen(false)
      return error
    },
    [onSaveUserName],
  )

  return (
    <div className="tapestry-forest-bar">
      <SaveIndicator filePath={filePath} saveState={saveState} />

      <span className="tapestry-forest-popover-anchor">
        <button
          ref={agentsButtonRef}
          type="button"
          className="tapestry-forest-button"
          aria-haspopup="dialog"
          aria-expanded={isAgentsOpen}
          onClick={() => setIsAgentsOpen((open) => !open)}
        >
          {agentsButtonText(agentsEnabled, agents)}
        </button>

        {isAgentsOpen && (
          <AgentsPanel
            agents={agents}
            enabled={agentsEnabled}
            onRefresh={onAgentsRefresh}
            onClose={() => setIsAgentsOpen(false)}
          />
        )}
      </span>

      {userName !== null && (
        <button
          type="button"
          className="tapestry-forest-button"
          title="Your changes are signed with this name"
          onClick={() => setIsNameOpen(true)}
        >
          {`user.${userName}`}
        </button>
      )}

      {isNameOpen && userName !== null && (
        <NamePromptDialog
          mode="change"
          initialName={userName}
          onSave={handleSaveName}
          onKeep={() => setIsNameOpen(false)}
        />
      )}
    </div>
  )
}
