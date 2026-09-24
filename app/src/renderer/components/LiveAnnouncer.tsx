/**
 * LiveAnnouncer — the space's two live regions (UI-SPEC "Screen-reader
 * announcements for visual-only cues").
 *
 * Several things in Tapestry are said only by a change in appearance: a frame
 * turning into a drop target, a status line replacing another in a header, a
 * tree that has just become unreadable. A screen reader is told none of that
 * unless something writes it down, so this is where it gets written.
 *
 * Two regions, not one, and the split is the contract: a polite region for
 * things that have already happened and can wait for a pause, an assertive one
 * for errors, which are announced once when they appear. One region shared by
 * both would either interrupt constantly or bury the failures.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/** What a component can ask the space to say. */
export interface Announcer {
  /** Something that happened; announced at the next pause. */
  polite(text: string): void
  /** Something that failed; announced as soon as it appears. */
  assertive(text: string): void
}

const AnnouncerContext = createContext<Announcer | null>(null)

/** Announcing is never load-bearing, so outside a provider it is a no-op. */
const silent: Announcer = {
  polite: () => {},
  assertive: () => {},
}

/**
 * The space's announcer.
 *
 * Deliberately does not throw without a provider: a component that announces
 * should still render in a test or a story, and a missing live region is a
 * degraded experience rather than a broken screen.
 */
export function useAnnounce(): Announcer {
  return useContext(AnnouncerContext) ?? silent
}

interface LiveAnnouncerProps {
  children: React.ReactNode
}

export function LiveAnnouncer({ children }: LiveAnnouncerProps): React.ReactElement {
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')

  /** Frames scheduled but not yet run, so unmount can cancel them. */
  const framesRef = useRef<number[]>([])

  useEffect(
    () => () => {
      for (const frame of framesRef.current) cancelAnimationFrame(frame)
      framesRef.current = []
    },
    [],
  )

  const say = useCallback((set: (text: string) => void, text: string) => {
    if (text.length === 0) return

    // Clear, then set on the next frame. Assigning a live region the string it
    // already holds is not a change, so a screen reader says nothing — which
    // is exactly the case that matters here: the same failure happening twice
    // must be heard twice.
    set('')
    const frame = requestAnimationFrame(() => {
      framesRef.current = framesRef.current.filter((pending) => pending !== frame)
      set(text)
    })
    framesRef.current.push(frame)
  }, [])

  const announcer = useMemo<Announcer>(
    () => ({
      polite: (text: string) => say(setPolite, text),
      assertive: (text: string) => say(setAssertive, text),
    }),
    [say],
  )

  return (
    <AnnouncerContext.Provider value={announcer}>
      {children}

      {/* Visually hidden rather than display:none: a hidden region is not
          announced at all, so it has to remain in the accessibility tree. */}
      <div
        className="tapestry-visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {polite}
      </div>

      <div
        className="tapestry-visually-hidden"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {assertive}
      </div>
    </AnnouncerContext.Provider>
  )
}

export default LiveAnnouncer
