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
import { EditorState, type Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history } from 'prosemirror-history'
import { collab, getVersion, receiveTransaction } from 'prosemirror-collab'
import { Step } from 'prosemirror-transform'
import { tapestrySchema } from '../editor/schema'
import { causeOf, collapsedCompositionStep, insertedTextOf, stripMarksFromSlice, threadRedo, threadUndo } from './recorder'
import type { ThreadCause } from '../../shared/threads/grammar'

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
}

export interface UseThreadEditorResult {
  editorRef: React.RefObject<HTMLDivElement>
  /** True once the view is bound to the authoritative document and version
   * (phase 2): writing is unlocked and the caret is live. */
  isEditable: boolean
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
}: UseThreadEditorOptions): UseThreadEditorResult {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [isEditable, setIsEditable] = useState(false)

  const onPushRef = useRef(onPush)
  onPushRef.current = onPush
  const onLocalInsertRef = useRef(onLocalInsert)
  onLocalInsertRef.current = onLocalInsert

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

  useEffect(() => {
    if (!editorRef.current) return

    const editable = ready !== null
    const doc = ready ? tapestrySchema.nodeFromJSON(ready.doc) : deserializeCheckpoint(checkpointBody)

    const plugins: Plugin[] = [history(), keymap({ 'Mod-z': threadUndo, 'Mod-Shift-z': threadRedo }), keymap(baseKeymap)]
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
        const newState = view.state.apply(tr)
        view.updateState(newState)
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
    if (editable) view.focus()

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // ready is an object recreated once (catch-up -> ready); nodeId changing
    // also recreates the view, matching use-prosemirror.ts's own effect deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, ready])

  return { editorRef, isEditable }
}
