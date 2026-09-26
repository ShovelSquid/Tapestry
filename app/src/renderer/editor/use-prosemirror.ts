/**
 * useProseMirror -- shared React hook encapsulating ProseMirror lifecycle.
 *
 * Consumed by NoteCard and KnotNode (D-26 universal editing).
 * Handles: editor creation, debounced autosave (D-02), external body sync
 * (undo/redo, plugin writes), formatting keybindings (D-23), and editability
 * toggling.
 *
 * The hook owns the EditorView and EditorState. The consumer provides
 * callbacks for save, dirty/clean tracking, and an optional plugins array.
 */

import { useCallback, useEffect, useRef } from 'react'
import { EditorState, Plugin, Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Node as ProseMirrorNode, Fragment, Slice } from 'prosemirror-model'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, setBlockType } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import type { Command } from 'prosemirror-state'
import { tapestrySchema } from './schema'
import { createPassagePlugin } from './passage-plugin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseProseMirrorOptions {
  nodeId: string
  initialBody: string
  isEditing: boolean
  onSave: (nodeId: string, body: string) => void
  onMarkDirty: (nodeId: string) => void
  onMarkClean: (nodeId: string) => void
  /** Extra ProseMirror plugins (e.g. placeholder plugin) */
  plugins?: Plugin[]
  /**
   * Called when the active (innermost) passage at the pointer changes.
   * Receives the anchorId or null when leaving all passages.
   * Lets Canvas highlight the corresponding thread and remote endpoint (D-13).
   */
  onPassageHover?: (anchorId: string | null) => void
}

export interface UseProseMirrorResult {
  /** Attach to the element that should host the editor (`<div ref={editorRef} />`). */
  editorRef: React.RefObject<HTMLDivElement>
  viewRef: React.RefObject<EditorView | null>
  /**
   * Get the current ProseMirror text selection range.
   * Returns null when no text is selected (collapsed cursor).
   */
  getSelection: () => { from: number; to: number; hasSelection: boolean } | null
  /**
   * Apply a passage mark with the given anchorId to the specified range.
   * Used by the passage connection flow (D-09).
   */
  applyPassageMark: (anchorId: string, from: number, to: number) => void
  /**
   * Force an immediate save of the current editor content,
   * flushing any pending debounce.
   */
  forceSave: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toggleHeading(level: number): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    const node = $from.parent
    if (node.type === tapestrySchema.nodes.heading && node.attrs.level === level) {
      return setBlockType(tapestrySchema.nodes.paragraph)(state, dispatch)
    }
    return setBlockType(tapestrySchema.nodes.heading, { level })(state, dispatch)
  }
}

/**
 * Build a ProseMirror doc from plain text, one paragraph per line.
 * Text is inserted as text nodes through the schema -- never parsed as HTML
 * (T-2.1-02 mitigation).
 */
function plainTextToDoc(body: string): ProseMirrorNode {
  const paragraphs = body.split('\n').map((line) =>
    line
      ? tapestrySchema.node('paragraph', null, [tapestrySchema.text(line)])
      : tapestrySchema.node('paragraph'),
  )
  return tapestrySchema.node('doc', null, paragraphs)
}

interface DeserializedBody {
  doc: ProseMirrorNode | null
  /**
   * True when the body IS a ProseMirror JSON doc but failed schema validation
   * (unknown node/mark from a newer plugin version, corrupted attrs). The doc
   * is then the raw JSON as plain text and the editor must be read-only so
   * the readable body is never overwritten by an escaped blob.
   */
  schemaError: boolean
}

/**
 * Parse body as ProseMirror JSON. Two distinct failure modes:
 *   - not JSON at all      -> legacy plain text, one paragraph per line
 *   - JSON but bad schema  -> plain-text fallback + schemaError (read-only)
 */
export function deserializeBody(body: string): DeserializedBody {
  if (!body) return { doc: null, schemaError: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    // Not JSON -- plain text from before rich text was added
    return { doc: plainTextToDoc(body), schemaError: false }
  }
  if (parsed && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'doc') {
    try {
      return { doc: tapestrySchema.nodeFromJSON(parsed), schemaError: false }
    } catch (err) {
      console.error(
        '[tapestry] Note body is a ProseMirror document but failed schema validation; ' +
          'showing it read-only to avoid overwriting it.',
        err,
      )
      return { doc: plainTextToDoc(body), schemaError: true }
    }
  }
  return { doc: plainTextToDoc(body), schemaError: false }
}

const UNREADABLE_CLASS = 'tapestry-editor-unreadable'

function serializeBody(view: EditorView): string {
  return JSON.stringify(view.state.doc.toJSON())
}

/**
 * Remove passage marks from a fragment, recursively.
 *
 * Passage anchorIds must be unique endpoints of a thread. ProseMirror's
 * clipboard serializer emits the data-passage-id span and parseDOM recreates
 * the mark, so copy/paste (or drag/drop) would otherwise clone an anchorId
 * into a second region of this or another note.
 */
function stripPassageMarks(fragment: Fragment): Fragment {
  const passage = tapestrySchema.marks.passage
  const nodes: ProseMirrorNode[] = []
  fragment.forEach((node) => {
    if (node.isText) {
      // Text nodes have no content; only their mark set changes.
      nodes.push(node.mark(passage.removeFromSet(node.marks)))
      return
    }
    const unmarked = node.isInline ? node.mark(passage.removeFromSet(node.marks)) : node
    nodes.push(unmarked.copy(stripPassageMarks(unmarked.content)))
  })
  return Fragment.fromArray(nodes)
}

/** Plugin: pasted/dropped content never carries passage marks (WR-08). */
const stripPastedPassagesPlugin = new Plugin({
  props: {
    transformPasted(slice: Slice): Slice {
      return new Slice(stripPassageMarks(slice.content), slice.openStart, slice.openEnd)
    },
  },
})

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProseMirror({
  nodeId,
  initialBody,
  isEditing,
  onSave,
  onMarkDirty,
  onMarkClean,
  plugins: extraPlugins,
  onPassageHover,
}: UseProseMirrorOptions): UseProseMirrorResult {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The last body this editor itself emitted through onSave. When the
  // external body prop catches up to it, that is an echo of our own save.
  const lastEmittedBodyRef = useRef<string>(initialBody)

  // Stable refs for callbacks used inside dispatchTransaction
  const onSaveRef = useRef(onSave)
  const onMarkDirtyRef = useRef(onMarkDirty)
  const onMarkCleanRef = useRef(onMarkClean)
  onSaveRef.current = onSave
  onMarkDirtyRef.current = onMarkDirty
  onMarkCleanRef.current = onMarkClean

  // Store nodeId in a ref so dispatchTransaction always sees current value
  const nodeIdRef = useRef(nodeId)
  nodeIdRef.current = nodeId

  // Stable ref for the passage hover callback
  const onPassageHoverRef = useRef(onPassageHover)
  onPassageHoverRef.current = onPassageHover

  // Set when the current body failed schema validation (see deserializeBody).
  // While true the editor is read-only and never emits saves.
  const schemaErrorRef = useRef(false)

  // -----------------------------------------------------------------------
  // Initialize ProseMirror editor
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!editorRef.current) return

    const initial = deserializeBody(initialBody)
    schemaErrorRef.current = initial.schemaError
    editorRef.current.classList.toggle(UNREADABLE_CLASS, initial.schemaError)
    const doc = initial.doc || tapestrySchema.node('doc', null, [
      tapestrySchema.node('paragraph'),
    ])

    // Passage plugin: gradient-of-focus decorations + hover tracking (D-14).
    // The callback is wrapped so the plugin always calls the latest ref.
    const passagePlugin = createPassagePlugin((anchorId) => {
      onPassageHoverRef.current?.(anchorId)
    })

    const builtinPlugins = [
      passagePlugin,
      stripPastedPassagesPlugin,
      history(),
      // Formatting keybindings (D-23): bold, italic, headings, undo/redo
      keymap({
        'Mod-b': toggleMark(tapestrySchema.marks.strong),
        'Mod-i': toggleMark(tapestrySchema.marks.em),
        'Mod-1': toggleHeading(1),
        'Mod-2': toggleHeading(2),
        'Mod-3': toggleHeading(3),
      }),
      keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo }),
      keymap(baseKeymap),
    ]

    const allPlugins = extraPlugins
      ? [...extraPlugins, ...builtinPlugins]
      : builtinPlugins

    const state = EditorState.create({
      doc,
      schema: tapestrySchema,
      plugins: allPlugins,
    })

    const nid = nodeIdRef.current
    lastEmittedBodyRef.current = initialBody

    const view = new EditorView(editorRef.current, {
      state,
      editable: () => isEditing && !schemaErrorRef.current,
      dispatchTransaction(tr: Transaction) {
        const newState = view.state.apply(tr)
        view.updateState(newState)

        // Transactions tagged externalSync come from the body-sync effect
        // below: they are already saved and must not be treated as user edits.
        // A schema-invalid body is read-only and must never be re-saved.
        if (tr.docChanged && !tr.getMeta('externalSync') && !schemaErrorRef.current) {
          onMarkDirtyRef.current(nid)

          if (debounceRef.current) {
            clearTimeout(debounceRef.current)
          }
          debounceRef.current = setTimeout(() => {
            debounceRef.current = null
            onMarkCleanRef.current(nid)
            const newBody = serializeBody(view)
            lastEmittedBodyRef.current = newBody
            onSaveRef.current(nid, newBody)
          }, 300)
        }
      },
    })

    viewRef.current = view

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
        onMarkCleanRef.current(nid)
        if (viewRef.current) {
          const finalBody = serializeBody(viewRef.current)
          if (finalBody !== initialBody) {
            lastEmittedBodyRef.current = finalBody
            onSaveRef.current(nid, finalBody)
          }
        }
      }
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  // -----------------------------------------------------------------------
  // Sync the editor when the kernel's body changes underneath it
  // -----------------------------------------------------------------------

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    // Echo of a body this editor emitted
    if (initialBody === lastEmittedBodyRef.current) return
    // The user is mid-edit; the pending debounce will save their version
    if (debounceRef.current) return

    const currentBody = JSON.stringify(view.state.doc.toJSON())
    if (currentBody === initialBody) {
      lastEmittedBodyRef.current = initialBody
      return
    }

    const next = deserializeBody(initialBody)
    schemaErrorRef.current = next.schemaError
    editorRef.current?.classList.toggle(UNREADABLE_CLASS, next.schemaError)
    const newDoc = next.doc || tapestrySchema.node('doc', null, [
      tapestrySchema.node('paragraph'),
    ])
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content)
    tr.setMeta('addToHistory', false)
    tr.setMeta('externalSync', true)
    view.dispatch(tr)
    lastEmittedBodyRef.current = initialBody
  }, [initialBody])

  // -----------------------------------------------------------------------
  // Update editability when isEditing changes
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.setProps({ editable: () => isEditing && !schemaErrorRef.current })
      if (isEditing && !schemaErrorRef.current) {
        viewRef.current.focus()
      }
    }
  }, [isEditing])

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  const getSelection = useCallback((): { from: number; to: number; hasSelection: boolean } | null => {
    const view = viewRef.current
    if (!view) return null
    const { from, to } = view.state.selection
    return { from, to, hasSelection: from !== to }
  }, [])

  const applyPassageMark = useCallback((anchorId: string, from: number, to: number) => {
    const view = viewRef.current
    if (!view) return
    const mark = tapestrySchema.marks.passage.create({ anchorId })
    const tr = view.state.tr.addMark(from, to, mark)
    view.dispatch(tr)
  }, [])

  const forceSave = useCallback(() => {
    const view = viewRef.current
    if (!view || schemaErrorRef.current) return
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    onMarkCleanRef.current(nodeIdRef.current)
    const body = serializeBody(view)
    lastEmittedBodyRef.current = body
    onSaveRef.current(nodeIdRef.current, body)
  }, [])

  return { editorRef, viewRef, getSelection, applyPassageMark, forceSave }
}
