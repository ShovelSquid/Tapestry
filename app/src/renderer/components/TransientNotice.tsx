/**
 * TransientNotice -- a top-center message that says something happened and
 * then gets out of the way (UI-SPEC "Agent writes that interrupt a native
 * tree").
 *
 * It uses the PluginErrorNotification surface so every notice and modal in
 * Tapestry shares one width and one shadow.
 *
 * `role="status"` rather than an alert: the thing being reported has already
 * happened and needs no decision, so a screen reader should mention it at the
 * next opportunity instead of interrupting.
 */

import React, { useEffect } from 'react'

/** How long the notice stays before hiding itself (UA-14). */
const VISIBLE_MS = 6000

interface TransientNoticeProps {
  /** Changing this restarts the timer, so a second event is fully shown. */
  message: string
  onHide: () => void
}

export default function TransientNotice({
  message,
  onHide,
}: TransientNoticeProps): React.ReactElement {
  useEffect(() => {
    const timer = setTimeout(onHide, VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [message, onHide])

  return (
    <div className="tapestry-transient-notice" role="status">
      {message}
    </div>
  )
}
