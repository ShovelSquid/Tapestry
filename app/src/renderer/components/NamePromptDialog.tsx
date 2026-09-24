/**
 * NamePromptDialog -- asks what to sign changes with (D-07).
 *
 * Shown on first launch before the canvas will accept anything, and later
 * from the name button to change it. The live preview shows the exact line
 * that will appear in the `.tree` file, because that file is the thing the
 * name is really for.
 */

import React, { useCallback, useRef, useState } from 'react'
import Dialog from './Dialog'

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Mirrors ACTOR_NAME_RE in app/src/main/commands/actor.ts.
 *
 * The renderer cannot import main-process modules, so the rule is duplicated
 * rather than shared. This copy only decides what the dialog lets you press;
 * main validates again before anything is written, so the two disagreeing
 * costs a confusing error, never a bad actor id.
 */
const USER_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

const VALIDATION_MESSAGE =
  'Use lowercase letters, numbers, - or _ (1 to 32 characters, starting with a letter or number).'

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const COPY = {
  'first-run': {
    title: 'What should Tapestry call you?',
    body:
      "Every change you make is signed with this name in your trees' history. " +
      'Past changes keep the name they were signed with.',
    primary: 'Save my name',
  },
  change: {
    title: 'Change your name',
    body:
      'Changes from now on are signed with the new name. ' +
      'Past changes keep their original name.',
    primary: 'Save name',
  },
} as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NamePromptDialogProps {
  mode: 'first-run' | 'change'
  initialName: string
  /** Resolves to an error message to display, or null on success. */
  onSave: (name: string) => Promise<string | null>
  /** Change mode only: dismiss without changing the stored name. */
  onKeep?: () => void
}

// ---------------------------------------------------------------------------
// NamePromptDialog
// ---------------------------------------------------------------------------

export default function NamePromptDialog({
  mode,
  initialName,
  onSave,
  onKeep,
}: NamePromptDialogProps): React.ReactElement {
  const [value, setValue] = useState(initialName)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const fieldRef = useRef<HTMLInputElement>(null)

  const copy = COPY[mode]
  const isValid = USER_NAME_RE.test(value)

  const handleSave = useCallback(async () => {
    if (!isValid || isSaving) return
    setIsSaving(true)
    setSaveError(null)
    try {
      const error = await onSave(value)
      if (error) setSaveError(error)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSaving(false)
    }
  }, [isValid, isSaving, onSave, value])

  const handleFieldKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        handleSave()
      }
    },
    [handleSave],
  )

  // Select the prefilled value so the first keystroke replaces it.
  const handleFieldRef = useCallback((node: HTMLInputElement | null) => {
    ;(fieldRef as React.MutableRefObject<HTMLInputElement | null>).current = node
    node?.select()
  }, [])

  const buttons = (
    <>
      {mode === 'change' && onKeep && (
        <button type="button" className="tapestry-button--secondary" onClick={onKeep}>
          Keep current name
        </button>
      )}
      <button
        type="button"
        className="tapestry-button--primary"
        onClick={handleSave}
        disabled={!isValid || isSaving}
      >
        {copy.primary}
      </button>
    </>
  )

  return (
    <Dialog
      title={copy.title}
      buttons={buttons}
      // First-run has no dismiss action, so Escape is ignored (UA-15).
      onDismiss={mode === 'change' ? onKeep : undefined}
      initialFocusRef={fieldRef as React.RefObject<HTMLElement>}
    >
      <p className="tapestry-dialog-text">{copy.body}</p>

      <label className="tapestry-field-label" htmlFor="tapestry-user-name">
        Your name
      </label>
      <input
        id="tapestry-user-name"
        className="tapestry-field-input"
        type="text"
        value={value}
        ref={handleFieldRef}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleFieldKeyDown}
        disabled={isSaving}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={!isValid}
      />

      <p className="tapestry-dialog-preview">
        {`Your changes will read: actor human user.${value}`}
      </p>

      {!isValid && <p className="tapestry-field-error">{VALIDATION_MESSAGE}</p>}
      {saveError && <p className="tapestry-field-error">{saveError}</p>}
    </Dialog>
  )
}
