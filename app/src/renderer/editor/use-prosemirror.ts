/**
 * useProseMirror -- shared React hook encapsulating ProseMirror lifecycle.
 *
 * Consumed by NoteCard and ThreadCenterNode (D-26 universal editing).
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
import { Node as ProseMirrorNode } from 'prosemirror-model'
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
  editorRef: React.RefObject<HTMLDivElement | null>
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

/**
 * Try to parse body as ProseMirror JSON. If it fails (plain text from before
 * rich text was added), create a doc with paragraphs of text nodes.
 */
function deserializeBody(body: string): ProseMirrorNode | null {
  if (!body) return null
  try {
    const parsed = JSON.parse(body)
    if (parsed && parsed.type === 'doc') {
      return tapestrySchema.nodeFromJSON(parsed)
    }
  } catch {
    // Not JSON -- treat as plain text
  }
  return plainTextToDoc(body)
}

function serializeBody(view: EditorView): string {
  return JSON.stringify(view.state.doc.toJSON())
}

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
  const editorRef = useRef<HTMLDivElement | null>(null)
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

  // -----------------------------------------------------------------------
  // Initialize ProseMirror editor
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!editorRef.current) return

    const doc = deserializeBody(initialBody) || tapestrySchema.node('doc', null, [
      tapestrySchema.node('paragraph'),
    ])

    // Passage plugin: gradient-of-focus decorations + hover tracking (D-14).
    // The callback is wrapped so the plugin always calls the latest ref.
    const passagePlugin = createPassagePlugin((anchorId) => {
      onPassageHoverRef.current?.(anchorId)
    })

    const builtinPlugins = [
      passagePlugin,
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
      editable: () => isEditing,
      dispatchTransaction(tr: Transaction) {
        const newState = view.state.apply(tr)
        view.updateState(newState)

        // Transactions tagged externalSync come from the body-sync effect
        // below: they are already saved and must not be treated as user edits.
        if (tr.docChanged && !tr.getMeta('externalSync')) {
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

    const newDoc = deserializeBody(initialBody) || tapestrySchema.node('doc', null, [
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
      viewRef.current.setProps({ editable: () => isEditing })
      if (isEditing) {
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
    if (!view) return
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
