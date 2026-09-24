/**
 * useThreadEditor -- collab-based ProseMirror hook for the thread typer
 * (D-02, D-09).
 *
 * Two phases, matching UI-SPEC "Loading and catch-up":
 *  - Phase 1 (catching up, `ready === null`): a read-only view showing the
 *    node's last `body` checkpoint text, created synchronously in the same
 *    effect run that mounts the component, so nothing is ever blank
 *    (rule 1).
 *  - Phase 2 (ready, `ready !== null`): once `thread:open`'s replay
 *    resolves, the view is recreated bound to `prosemirror-collab` at the
 *    authoritative version and document, and becomes editable (rule 2).
 *
 * Deliberately does NOT reuse `use-prosemirror.ts`'s body-sync effect
 * (`tr.replaceWith(0, doc.content.size, newDoc.content)` on every external
 * body change): that effect fights collab and erases rebased steps
 * (RESEARCH Anti-Patterns). This hook never re-syncs a live collab document
 * from an external prop after phase 2 begins -- the document only ever
 * changes through steps this hook itself applies or receives.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorState, Plugin, PluginKey } from 'prosemirror-state'
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view'
import { Fragment, Slice, type Node as ProseMirrorNode } from 'prosemirror-model'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history } from 'prosemirror-history'
import { collab, getVersion, receiveTransaction } from 'prosemirror-collab'
import { ReplaceStep, Step } from 'prosemirror-transform'
import { tapestrySchema } from '../editor/schema'
import { causeOf, collapsedCompositionStep, insertedTextOf, stripMarksFromSlice, threadRedo, threadUndo } from './recorder'
import { LetterIndex } from '../../shared/threads/letters'
import { authorPattern, authorToken } from './author-palette'
import type { ThreadCause } from '../../shared/threads/grammar'

// ---------------------------------------------------------------------------
// D-21 author underlay: DecorationSet built from a renderer-local LetterIndex
// ---------------------------------------------------------------------------

const AUTHOR_DECORATIONS_KEY = new PluginKey<DecorationSet>('tap-author-decorations')

const AUTHOR_UNDERLINE_STYLE: Record<ReturnType<typeof authorPattern>, string> = {
  solid: 'solid',
  dotted: 'dotted',
  dashed: 'dashed',
  'long-dash': 'dashed',
  'dash-dot': 'dashed',
  double: 'double',
  wavy: 'wavy',
}

/** Builds the underlay decoration set from a `LetterIndex`'s own
 * `runsForDecorations()` -- the CSS classes/vars this attaches are always
 * present in the DOM; App.css only *reveals* the wash under
 * `.tap-reveal-authors` or `:hover` (UI-SPEC "Revealing the underlay
 * without striping the typer"), so building this on every doc change is
 * cheap and never itself the thing gating visibility. */
function buildAuthorDecorations(doc: ProseMirrorNode, letterIndex: LetterIndex, orderedAgentNames: readonly string[]): DecorationSet {
  const decorations: Decoration[] = []
  for (const run of letterIndex.runsForDecorations()) {
    if (run.utf16Length === 0) continue
    const token = authorToken(run.actor, orderedAgentNames)
    const pattern = authorPattern(run.actor, orderedAgentNames)
    decorations.push(
      Decoration.inline(run.pos, run.pos + run.utf16Length, {
        class: 'tap-author-underlay',
        style: `--tap-author-underlay-color: var(${token}); text-decoration-line: underline; text-decoration-style: ${AUTHOR_UNDERLINE_STYLE[pattern]};`,
        'data-actor': run.actor,
      }),
    )
  }
  return DecorationSet.create(doc, decorations)
}

/** The literal actor id immediately before `pos` (D-21's caret readout), or
 * null at the very start of the document. */
function authorBeforeCaret(letterIndex: LetterIndex, pos: number): string | null {
  if (pos <= 1) return null
  const ids = letterIndex.lettersIn(pos - 1, pos)
  const id = ids[ids.length - 1]
  return id === undefined ? null : (letterIndex.authorOf(id) ?? null)
}

export type ThreadPushResult =
  | { confirmed: true; version: number }
  | { confirmed: false; missing: { steps: unknown[]; fromVersion: number } }
  | { confirmed: false; rejected: true; reason: string }

export interface ThreadReadyState {
  version: number
  /** ProseMirror JSON, from `tapestrySchema.nodeFromJSON`. */
  doc: unknown
}

export interface UseThreadEditorOptions {
  nodeId: string
  /** The checkpoint text to show immediately, read-only (rule 1). The same
   * two shapes `use-prosemirror.ts` accepts for a note's `body`: ProseMirror
   * JSON, or legacy plain text. */
  checkpointBody: string
  /** Non-null once replay finishes; flips the view from the read-only
   * checkpoint display to an editable collab-backed document (rule 2). */
  ready: ThreadReadyState | null
  onPush: (
    version: number,
    steps: unknown[],
    times: number[],
    causes: (ThreadCause | null)[],
  ) => Promise<ThreadPushResult>
  /**
   * Optimistic, local-only notification that `text` was inserted at
   * `tMs` -- fired synchronously inside `dispatchTransaction`, independent
   * of `onPush`'s async round trip to `ThreadService` (D-09's stage must
   * never wait on a commit to draw a keystroke; the plan's own words:
   * "a keystroke is never deferred for the animation"). Never fired for
   * an intermediate IME composition step (Pitfall 5): a composed run is
   * reported once, as a single insertion, at composition end.
   */
  onLocalInsert?: (tMs: number, text: string) => void
  /**
   * D-21: this actor's own literal id (`user.<name>`), used to attribute
   * every step this hook itself applies going forward. Known Stub: a step
   * that arrives via `receiveTransaction` (an agent's write landing while
   * this exact view is open) is also attributed to this id, since main does
   * not yet broadcast a live steps payload naming its real author --
   * reopening the thread always attributes every letter correctly, from
   * the authoritative replay (`ThreadOverlay.tsx`'s own stage build).
   */
  selfActorId: string
  /** D-21: agent names in first-connected order (`author-palette.ts`'s own
   * ordering contract), for the underlay's colour/pattern lookup. */
  orderedAgentNames: readonly string[]
  /** The thread's live letters, in document order, as they stood at the
   * moment this view opened (`ReplayResult.liveOrder`-ordered) -- seeds this
   * hook's own `LetterIndex` so the underlay is correct from the first
   * frame, not just for letters typed after this session began. */
  initialLiveLetters?: ReadonlyArray<{ grapheme: string; actor: string }>
}

export interface UseThreadEditorResult {
  editorRef: React.RefObject<HTMLDivElement>
  /** True once the view is bound to the authoritative document and version
   * (phase 2): writing is unlocked and the caret is live. */
  isEditable: boolean
  /** D-21 caret authorship readout: "After text by [actor id]" / "At the
   * start of the document" -- a live region under the typer reads this
   * directly, updated on every selection change and throttled to 300ms. */
  captionText: string
  /** D-21: the literal actor id currently hovered, with the DOM-space
   * coordinates to anchor an `AuthorChip` at, or null when nothing is
   * hovered. */
  hoveredAuthor: { actorId: string; x: number; y: number } | null
}

// ---------------------------------------------------------------------------
// Building a doc from the checkpoint text (mirrors use-prosemirror.ts)
// ---------------------------------------------------------------------------

function plainTextToDoc(body: string): ProseMirrorNode {
  const paragraphs = body
    .split('\n')
    .map((line) =>
      line ? tapestrySchema.node('paragraph', null, [tapestrySchema.text(line)]) : tapestrySchema.node('paragraph'),
    )
  return tapestrySchema.node('doc', null, paragraphs.length > 0 ? paragraphs : [tapestrySchema.node('paragraph')])
}

function deserializeCheckpoint(body: string): ProseMirrorNode {
  if (!body) return tapestrySchema.node('doc', null, [tapestrySchema.node('paragraph')])
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'doc') {
      return tapestrySchema.nodeFromJSON(parsed)
    }
  } catch {
    // Not JSON: legacy plain text, one paragraph per line.
  }
  return plainTextToDoc(body)
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useThreadEditor({
  nodeId,
  checkpointBody,
  ready,
  onPush,
  onLocalInsert,
  selfActorId,
  orderedAgentNames,
  initialLiveLetters,
}: UseThreadEditorOptions): UseThreadEditorResult {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [isEditable, setIsEditable] = useState(false)
  const [captionText, setCaptionText] = useState('')
  const [hoveredAuthor, setHoveredAuthor] = useState<{ actorId: string; x: number; y: number } | null>(null)

  const onPushRef = useRef(onPush)
  onPushRef.current = onPush
  const onLocalInsertRef = useRef(onLocalInsert)
  onLocalInsertRef.current = onLocalInsert
  const selfActorIdRef = useRef(selfActorId)
  selfActorIdRef.current = selfActorId
  const orderedAgentNamesRef = useRef(orderedAgentNames)
  orderedAgentNamesRef.current = orderedAgentNames

  // D-21: this hook's own renderer-local LetterIndex, seeded from the
  // thread's live letters at open and kept exactly in step with every step
  // this view itself applies or receives afterward -- the source
  // `buildAuthorDecorations`/`authorBeforeCaret` both read.
  const letterIndexRef = useRef<LetterIndex | null>(null)
  const captionThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  type Captured = { stepJson: unknown; timeMs: number; cause: ThreadCause | null; insertedText: string }
  const wasComposingRef = useRef(false)
  // The document immediately before the current composition run started
  // (Pitfall 5): captured once, on the first composing transaction, so the
  // whole run can be collapsed into a single step at composition end
  // instead of replaying every intermediate revision it churned through.
  const composingStartDocRef = useRef<ProseMirrorNode | null>(null)

  const pushBatch = useCallback((steps: unknown[], times: number[], causes: (ThreadCause | null)[]) => {
    const view = viewRef.current
    if (!view || steps.length === 0) return
    const version = getVersion(view.state)
    onPushRef.current(version, steps, times, causes)
      .then((result) => {
        const v = viewRef.current
        if (!v) return
        if (result.confirmed) return
        if ('missing' in result && result.missing) {
          const remoteSteps = result.missing.steps.map((json) => Step.fromJSON(tapestrySchema, json))
          const clientIDs = remoteSteps.map(() => 'main')
          v.dispatch(receiveTransaction(v.state, remoteSteps, clientIDs))
        }
      })
      .catch((err) => {
        console.error('[useThreadEditor] push failed:', err)
      })
  }, [])

  const scheduleCaptionUpdate = useCallback((pos: number) => {
    if (captionThrottleRef.current) return
    captionThrottleRef.current = setTimeout(() => {
      captionThrottleRef.current = null
      const index = letterIndexRef.current
      if (!index) return
      const author = authorBeforeCaret(index, pos)
      setCaptionText(author ? `After text by ${author}` : 'At the start of the document')
    }, 300)
  }, [])

  // D-21: Opt (Alt) held reveals the underlay in the typer while held --
  // implemented as a plain CSS class toggle (App.css scopes the actual wash
  // under `.tap-reveal-authors`), independent of the view-recreation effect
  // below so holding Opt never rebuilds the editor.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Alt') editorRef.current?.classList.add('tap-reveal-authors')
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.key === 'Alt') editorRef.current?.classList.remove('tap-reveal-authors')
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useEffect(() => {
    if (!editorRef.current) return

    const editable = ready !== null
    const doc = ready ? tapestrySchema.nodeFromJSON(ready.doc) : deserializeCheckpoint(checkpointBody)

    // D-21: seeded once per view (re)creation from the thread's own live
    // letters as they stood at open, in document order -- so the underlay is
    // correct from the first frame, not only for letters typed this session.
    if (editable) {
      const index = new LetterIndex()
      let pos = 1
      for (const letter of initialLiveLetters ?? []) {
        const step = new ReplaceStep(pos, pos, new Slice(Fragment.from(tapestrySchema.text(letter.grapheme)), 0, 0))
        index.applyStep(step, letter.grapheme, letter.actor, Date.now())
        pos += letter.grapheme.length
      }
      letterIndexRef.current = index
    } else {
      letterIndexRef.current = null
    }

    const authorDecorationsPlugin = new Plugin({
      key: AUTHOR_DECORATIONS_KEY,
      state: {
        init: (_config, editorState) =>
          letterIndexRef.current
            ? buildAuthorDecorations(editorState.doc, letterIndexRef.current, orderedAgentNamesRef.current)
            : DecorationSet.empty,
        apply(tr, old) {
          const meta = tr.getMeta(AUTHOR_DECORATIONS_KEY) as DecorationSet | undefined
          return meta ?? old.map(tr.mapping, tr.doc)
        },
      },
      props: {
        decorations(editorState) {
          return AUTHOR_DECORATIONS_KEY.getState(editorState) ?? DecorationSet.empty
        },
      },
    })

    const plugins: Plugin[] = [
      history(),
      keymap({ 'Mod-z': threadUndo, 'Mod-Shift-z': threadRedo }),
      keymap(baseKeymap),
      authorDecorationsPlugin,
    ]
    if (editable) {
      plugins.unshift(collab({ version: ready!.version }))
    }

    const state = EditorState.create({ doc, schema: tapestrySchema, plugins })

    const view = new EditorView(editorRef.current, {
      state,
      editable: () => editable,
      // T-02.3-05-01: a paste cannot import another actor's attribution.
      // There is no author mark in this schema (authorship is derived from
      // the host-stamped commit actor); `passage` is the one mark type
      // pasted content could otherwise carry in.
      transformPasted(slice) {
        return stripMarksFromSlice(slice, [tapestrySchema.marks.passage])
      },
      dispatchTransaction(tr) {
        const beforeDoc = view.state.doc

        // D-21: the LetterIndex and its decoration meta are updated BEFORE
        // this transaction is applied, so the same `apply()` pass that
        // advances every other plugin's state also picks up fresh
        // decorations for the resulting document -- never a second apply.
        // Known Stub: a step arriving via `receiveTransaction` (an agent's
        // write landing while this exact view is open) is attributed to
        // `selfActorIdRef.current` here too, the same limitation
        // `ThreadOverlay.tsx`'s `handleLocalInsert` already documents --
        // reopening the thread always attributes every letter correctly.
        if (editable && tr.docChanged && letterIndexRef.current) {
          for (const step of tr.steps) {
            letterIndexRef.current.applyStep(step, insertedTextOf(step), selfActorIdRef.current, Date.now())
          }
          tr.setMeta(
            AUTHOR_DECORATIONS_KEY,
            buildAuthorDecorations(tr.doc, letterIndexRef.current, orderedAgentNamesRef.current),
          )
        }

        const newState = view.state.apply(tr)
        view.updateState(newState)

        // D-21 caret readout: any selection change, not only a doc change --
        // moving the caret with arrow keys must update the readout too.
        if (editable && letterIndexRef.current && (tr.docChanged || tr.selectionSet)) {
          scheduleCaptionUpdate(newState.selection.from)
        }

        if (!editable || !tr.docChanged) return

        const nowMs = Date.now()

        if (view.composing) {
          // Nothing is drawn and nothing is pushed while composing
          // (Pitfall 5): kana-preview churn dispatches several intermediate
          // replace transactions before the user commits a result, and
          // recording each one individually would flood thread.log with
          // revisions nobody ever actually typed. Only the moment
          // composition *started* is remembered, once.
          if (!wasComposingRef.current) composingStartDocRef.current = beforeDoc
          wasComposingRef.current = true
          return
        }

        if (wasComposingRef.current) {
          const startDoc = composingStartDocRef.current ?? beforeDoc
          wasComposingRef.current = false
          composingStartDocRef.current = null

          const collapsed = collapsedCompositionStep(startDoc, newState.doc)
          if (collapsed) {
            const text = insertedTextOf(collapsed)
            if (text) onLocalInsertRef.current?.(nowMs, text)
            pushBatch([collapsed.toJSON()], [nowMs], ['ime'])
          }
          return
        }

        const cause = causeOf(tr)
        const captured: Captured[] = tr.steps.map((step) => ({
          stepJson: step.toJSON(),
          timeMs: nowMs,
          cause,
          insertedText: insertedTextOf(step),
        }))

        // Optimistic, synchronous, per-step: the stage never waits for
        // onPush's round trip to draw a keystroke.
        for (const step of captured) {
          if (step.insertedText) onLocalInsertRef.current?.(step.timeMs, step.insertedText)
        }

        pushBatch(
          captured.map((s) => s.stepJson),
          captured.map((s) => s.timeMs),
          captured.map((s) => s.cause),
        )
      },
    })

    viewRef.current = view
    setIsEditable(editable)
    if (editable) {
      view.focus()
      // D-21: the readout names the author at the caret from the first
      // frame, not only after the first edit or selection change.
      scheduleCaptionUpdate(view.state.selection.from)
    } else {
      setCaptionText('')
    }

    // D-21: hovering a run of text (its own underlay decoration, tagged
    // `data-actor`) shows the literal actor id chip -- the wash itself is
    // revealed by App.css's `:hover` rule on the same element, so this
    // listener's only job is the chip's text and position.
    function handleMouseOver(e: MouseEvent): void {
      const target = (e.target as HTMLElement | null)?.closest('[data-actor]')
      const actorId = target?.getAttribute('data-actor')
      if (!target || !actorId) return
      const rect = target.getBoundingClientRect()
      setHoveredAuthor({ actorId, x: rect.left + rect.width / 2, y: rect.top })
    }
    function handleMouseOut(e: MouseEvent): void {
      const related = (e.relatedTarget as HTMLElement | null)?.closest('[data-actor]')
      if (related) return
      setHoveredAuthor(null)
    }
    if (editable) {
      view.dom.addEventListener('mouseover', handleMouseOver)
      view.dom.addEventListener('mouseout', handleMouseOut)
    }

    return () => {
      view.dom.removeEventListener('mouseover', handleMouseOver)
      view.dom.removeEventListener('mouseout', handleMouseOut)
      if (captionThrottleRef.current) {
        clearTimeout(captionThrottleRef.current)
        captionThrottleRef.current = null
      }
      view.destroy()
      viewRef.current = null
      letterIndexRef.current = null
    }
    // ready is an object recreated once (catch-up -> ready); nodeId changing
    // also recreates the view, matching use-prosemirror.ts's own effect deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, ready])

  return { editorRef, isEditable, captionText, hoveredAuthor }
}
