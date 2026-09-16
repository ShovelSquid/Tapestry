/**
 * ConnectAgentDialog -- name an agent, then copy the one command that
 * connects it (UI-SPEC "Agents panel", D-03/D-06).
 *
 * The dialog has two states, and the second one matters: the command carries
 * a token that exists in readable form **exactly once**. Only its SHA-256 is
 * stored, so once this dialog closes the token cannot be shown again. That is
 * why the command block is the focal point after creation, why Copy command
 * takes initial focus, and why the warning says plainly what to do if it is
 * lost (remove the agent and connect it again).
 */

import React, { useCallback, useRef, useState } from 'react'
import Dialog from './Dialog'

/**
 * Mirrors ACTOR_NAME_RE in app/src/main/commands/actor.ts.
 *
 * The renderer cannot import main-process modules, so the rule is duplicated.
 * This copy only decides what the dialog lets you press; main validates again
 * before an agent exists, so the two disagreeing costs a confusing message,
 * never a bad actor id.
 */
const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

const VALIDATION_MESSAGE =
  'Use lowercase letters, numbers, - or _ (1 to 32 characters, starting with a letter or number).'

interface ConnectAgentDialogProps {
  /** Dismiss, both before and after the agent is created. */
  onClose: () => void
  /** Called once an agent exists, so the list behind the dialog refreshes. */
  onCreated: () => void
}

export default function ConnectAgentDialog({
  onClose,
  onCreated,
}: ConnectAgentDialogProps): React.ReactElement {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  /** Non-null once the agent exists: the command to run, shown once. */
  const [command, setCommand] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fieldRef = useRef<HTMLInputElement>(null)
  const copyRef = useRef<HTMLButtonElement>(null)

  const isValid = AGENT_NAME_RE.test(value)

  const handleCreate = useCallback(async () => {
    if (!isValid || isCreating) return
    setIsCreating(true)
    setError(null)
    try {
      const result = await window.tapestry.agents.create(value)
      if (result.ok) {
        setCommand(result.command)
        onCreated()
      } else {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsCreating(false)
    }
  }, [isValid, isCreating, onCreated, value])

  const handleFieldKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        handleCreate()
      }
    },
    [handleCreate],
  )

  const handleCopy = useCallback(async () => {
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
    } catch {
      // Copying can be refused; the command stays selectable on screen, so
      // say so rather than pretending it was copied.
      setError('Could not copy. Select the command and copy it by hand.')
    }
  }, [command])

  // -------------------------------------------------------------------------
  // After creation: the command, shown once
  // -------------------------------------------------------------------------

  if (command !== null) {
    return (
      <Dialog
        title="Connect an agent"
        onDismiss={onClose}
        initialFocusRef={copyRef as React.RefObject<HTMLElement>}
        buttons={
          <>
            <button ref={copyRef} type="button" className="tapestry-button--secondary" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy command'}
            </button>
            <button type="button" className="tapestry-button--primary" onClick={onClose}>
              Close agent setup
            </button>
          </>
        }
      >
        <p className="tapestry-dialog-text">Run this in a terminal to connect Claude Code:</p>

        <pre className="tapestry-command-block">{command}</pre>

        <p className="tapestry-dialog-helper">
          This command contains a token shown only once. If you lose it, remove the agent and
          connect it again.
        </p>

        {error && <p className="tapestry-field-error">{error}</p>}
      </Dialog>
    )
  }

  // -------------------------------------------------------------------------
  // Before creation: the name
  // -------------------------------------------------------------------------

  return (
    <Dialog
      title="Connect an agent"
      onDismiss={onClose}
      initialFocusRef={fieldRef as React.RefObject<HTMLElement>}
      buttons={
        <>
          <button type="button" className="tapestry-button--secondary" onClick={onClose}>
            Don&apos;t connect agent
          </button>
          <button
            type="button"
            className="tapestry-button--primary"
            onClick={handleCreate}
            disabled={!isValid || isCreating}
          >
            Create connection
          </button>
        </>
      }
    >
      <label className="tapestry-field-label" htmlFor="tapestry-agent-name">
        Agent name
      </label>
      <input
        id="tapestry-agent-name"
        className="tapestry-field-input"
        type="text"
        value={value}
        ref={fieldRef}
        onChange={(event) => {
          setValue(event.target.value)
          setError(null)
        }}
        onKeyDown={handleFieldKeyDown}
        disabled={isCreating}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={value.length > 0 && !isValid}
      />

      <p className="tapestry-dialog-helper">
        {`Its changes are signed agent.${isValid ? value : 'name'}. `}
        Use lowercase letters, numbers, - or _.
      </p>

      {value.length > 0 && !isValid && <p className="tapestry-field-error">{VALIDATION_MESSAGE}</p>}
      {error && <p className="tapestry-field-error">{error}</p>}
    </Dialog>
  )
}
