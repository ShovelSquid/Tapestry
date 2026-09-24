/**
 * Dialog -- the shared modal shell (UI-SPEC "Dialogs (shared shell)").
 *
 * Every dialog in Tapestry uses this surface, so the overlay, the focus trap
 * and the Escape contract are written once. A dialog with no onDismiss has no
 * dismiss action, and Escape does nothing -- that is how the first-run name
 * prompt becomes unskippable without any special case here.
 */

import React, { useCallback, useEffect, useId, useRef } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DialogProps {
  title: string
  children: React.ReactNode
  /** The button row, right-aligned; dismiss sits left of the primary. */
  buttons: React.ReactNode
  /** Omit for a dialog that cannot be dismissed (Escape is then ignored). */
  onDismiss?: () => void
  /** Focused on open; otherwise the last button in the row takes focus. */
  initialFocusRef?: React.RefObject<HTMLElement>
}

/** Everything inside the surface that can hold focus. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export default function Dialog({
  title,
  children,
  buttons,
  onDismiss,
  initialFocusRef,
}: DialogProps): React.ReactElement {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Return focus to whatever held it before the dialog opened, so dismissing
  // does not drop the user at the top of the document.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [])

  // Initial focus: the caller's element, else the last button (the primary).
  useEffect(() => {
    const requested = initialFocusRef?.current
    if (requested) {
      requested.focus()
      return
    }
    const focusable = surfaceRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusable && focusable.length > 0) {
      focusable[focusable.length - 1].focus()
    }
  }, [initialFocusRef])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        // No dismiss action means there is nothing Escape could mean.
        if (onDismiss) {
          event.preventDefault()
          event.stopPropagation()
          onDismiss()
        }
        return
      }

      if (event.key !== 'Tab') return

      const focusable = surfaceRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (!focusable || focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !surfaceRef.current?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [onDismiss],
  )

  return (
    <div className="tapestry-dialog-overlay" onKeyDown={handleKeyDown}>
      <div
        className="tapestry-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={surfaceRef}
      >
        <h2 className="tapestry-dialog-title" id={titleId}>
          {title}
        </h2>
        <div className="tapestry-dialog-body">{children}</div>
        <div className="tapestry-dialog-buttons">{buttons}</div>
      </div>
    </div>
  )
}
