/**
 * ForestBar -- the top-left chrome (UI-SPEC "Forest bar").
 *
 * Save state used to live here, in one indicator for one world. The space now
 * holds several trees, so each frame's header carries its own status and this
 * corner holds only what is true of the whole space.
 *
 * Three controls: the Add tree menu, the Agents button (whose label is itself
 * the bridge's status), and the name button, which shows the actor id every
 * change of Kaelen's is signed with.
 *
 * The bar deliberately shows no tree names: a name belongs to its frame, so a
 * forest bar listing them would say the same thing twice and would be the one
 * place that had to grow with the number of open worlds.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import AgentsPanel from './AgentsPanel'
import NamePromptDialog from './NamePromptDialog'

interface ForestBarProps {
  agents: TapestryAgentSummary[]
  agentsEnabled: boolean
  /** Null while the first-run prompt is still up. */
  userName: string | null
  /** Resolves to an error message to display, or null on success. */
  onSaveUserName: (name: string) => Promise<string | null>
  onAgentsRefresh: () => void
  /** Add tree menu: mirror an Obsidian vault as its own tree (D-10, D-13). */
  onAddVault: () => void
  /** Add tree menu: put an existing world into the space. */
  onOpenWorld: () => void
  /** Add tree menu: create a world and put it into the space. */
  onNewWorld: () => void
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
  agents,
  agentsEnabled,
  userName,
  onSaveUserName,
  onAgentsRefresh,
  onAddVault,
  onOpenWorld,
  onNewWorld,
}: ForestBarProps): React.ReactElement {
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isAgentsOpen, setIsAgentsOpen] = useState(false)
  const [isNameOpen, setIsNameOpen] = useState(false)

  const agentsButtonRef = useRef<HTMLButtonElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  /**
   * The ways a tree can enter the space, in the order the UI-SPEC lists them.
   *
   * A list rather than hand-placed buttons: the vault entry went in at the head
   * of it without moving anything else, which is what adding a way in should
   * cost.
   */
  const addTreeItems: Array<{ label: string; run: () => void }> = [
    { label: 'Add Obsidian Vault...', run: onAddVault },
    { label: 'Open Tapestry World...', run: onOpenWorld },
    { label: 'New Tapestry World...', run: onNewWorld },
  ]

  const closeAddMenu = useCallback((returnFocus: boolean) => {
    setIsAddOpen(false)
    // Focus goes back to the button that opened the menu, so a keyboard user
    // is never dropped at the top of the document.
    if (returnFocus) addButtonRef.current?.focus()
  }, [])

  // Opening with the keyboard should land inside the menu, not beside it.
  useEffect(() => {
    if (!isAddOpen) return
    itemRefs.current[0]?.focus()
  }, [isAddOpen])

  useEffect(() => {
    if (!isAddOpen) return undefined

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      const insideMenu = addMenuRef.current?.contains(target) ?? false
      const onButton = addButtonRef.current?.contains(target) ?? false
      if (!insideMenu && !onButton) setIsAddOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [isAddOpen])

  /** Arrow keys walk the menu, Escape leaves it, Tab lets focus move on. */
  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAddMenu(true)
      return
    }
    if (event.key === 'Tab') {
      setIsAddOpen(false)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    event.preventDefault()
    const count = addTreeItems.length
    const current = itemRefs.current.findIndex((element) => element === document.activeElement)
    const from = current === -1 ? 0 : current
    const next = event.key === 'ArrowDown' ? (from + 1) % count : (from - 1 + count) % count
    itemRefs.current[next]?.focus()
  }

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
      <span className="tapestry-forest-popover-anchor">
        <button
          ref={addButtonRef}
          type="button"
          className="tapestry-forest-button"
          aria-haspopup="menu"
          aria-expanded={isAddOpen}
          onClick={() => setIsAddOpen((open) => !open)}
        >
          Add tree
        </button>

        {isAddOpen && (
          <div
            ref={addMenuRef}
            className="tapestry-menu"
            role="menu"
            aria-label="Add tree"
            onKeyDown={handleMenuKeyDown}
          >
            {addTreeItems.map((item, index) => (
              <button
                key={item.label}
                ref={(element) => {
                  itemRefs.current[index] = element
                }}
                type="button"
                role="menuitem"
                className="tapestry-menu-item"
                onClick={() => {
                  // Closed before the dialog opens: a native dialog takes the
                  // focus, and a menu left open behind it would still be there
                  // when the dialog closed.
                  closeAddMenu(false)
                  item.run()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </span>

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
