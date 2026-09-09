/**
 * NoteCard — renders a note at its world-space position with a ProseMirror
 * editor for inline text editing.
 *
 * Per D-04: Enter inserts a newline (ProseMirror default). The card receives
 * focus immediately after creation. Clicking text moves the caret. The note
 * is keyboard-first with minimal chrome.
 *
 * Text changes are debounced (300ms) before submitting through the kernel
 * bridge (D-02 autosave). The component communicates its debounce lifecycle
 * to the parent via onMarkDirty/onMarkClean so the save indicator never
 * shows "Saved" while a debounce timer is active.
 */

import React, { useCallback, useEffect, useRef } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Schema, DOMParser as ProseDOMParser } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'

// ---------------------------------------------------------------------------
// Schema — use prosemirror-schema-basic (doc, paragraph, text, marks)
// ---------------------------------------------------------------------------

const noteSchema = new Schema({
  nodes: basicSchema.spec.nodes,
  marks: basicSchema.spec.marks,
})

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NodeInfo {
  id: string
  type: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

interface NoteCardProps {
  node: NodeInfo
  isEditing: boolean
  onStartEditing: () => void
  onSave: (nodeId: string, body: string, title: string) => Promise<void>
  /** Called when a debounce timer starts (text changed, save pending). */
  onMarkDirty: (nodeId: string) => void
  /** Called when the debounce timer fires (save is about to be submitted). */
  onMarkClean: (nodeId: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNodeProp(
  node: NodeInfo,
  key: string,
  fallback: string | number | boolean = '',
): string | number | boolean {
  const prop = node.props[key]
  return prop ? prop.value : fallback
}

/**
 * Extract plain text from a ProseMirror doc, and derive a title from the
 * first line or heading.
 */
function extractTextAndTitle(view: EditorView): { body: string; title: string } {
  const doc = view.state.doc
  const lines: string[] = []
  let title = ''

  doc.forEach((child, _offset, index) => {
    const text = child.textContent
    if (index === 0 && text.trim()) {
      title = text.trim()
    }
    lines.push(text)
  })

  return { body: lines.join('\n'), title }
}

// ---------------------------------------------------------------------------
// NoteCard
// ---------------------------------------------------------------------------

export default function NoteCard({
  node,
  isEditing,
  onStartEditing,
  onSave,
  onMarkDirty,
  onMarkClean,
}: NoteCardProps): React.ReactElement {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const x = Number(getNodeProp(node, 'position.x', 100))
  const y = Number(getNodeProp(node, 'position.y', 100))
  const body = String(getNodeProp(node, 'body', ''))
  const title = String(getNodeProp(node, 'title', ''))

  // Stable refs for callbacks used inside ProseMirror dispatchTransaction
  const onSaveRef = useRef(onSave)
  const onMarkDirtyRef = useRef(onMarkDirty)
  const onMarkCleanRef = useRef(onMarkClean)
  onSaveRef.current = onSave
  onMarkDirtyRef.current = onMarkDirty
  onMarkCleanRef.current = onMarkClean

  // -----------------------------------------------------------------------
  // Initialize ProseMirror editor
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!editorRef.current) return

    // Parse existing body text into a ProseMirror document
    const element = document.createElement('div')
    if (body) {
      // Convert plain text lines to paragraphs
      const lines = body.split('\n')
      element.innerHTML = lines
        .map((line) => `<p>${line || '<br>'}</p>`)
        .join('')
    } else {
      element.innerHTML = '<p><br></p>'
    }

    const doc = ProseDOMParser.fromSchema(noteSchema).parse(element)

    const state = EditorState.create({
      doc,
      schema: noteSchema,
      plugins: [
        history(),
        keymap({ 'Mod-z': undo, 'Mod-Shift-z': redo }),
        keymap(baseKeymap),
      ],
    })

    const nodeId = node.id

    const view = new EditorView(editorRef.current, {
      state,
      editable: () => isEditing,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)

        if (tr.docChanged) {
          // Mark this note as dirty — indicator must show "Saving..."
          onMarkDirtyRef.current(nodeId)

          // Debounce: submit after 300ms of inactivity (D-02)
          if (debounceRef.current) {
            clearTimeout(debounceRef.current)
          }
          debounceRef.current = setTimeout(() => {
            debounceRef.current = null
            // Unmark dirty — the IPC call is about to start, tracked by pendingSavesRef
            onMarkCleanRef.current(nodeId)
            const { body: newBody, title: newTitle } = extractTextAndTitle(view)
            onSaveRef.current(nodeId, newBody, newTitle)
          }, 300)
        }
      },
    })

    viewRef.current = view

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
        // Flush pending save before unmount
        onMarkCleanRef.current(nodeId)
        if (viewRef.current) {
          const { body: finalBody, title: finalTitle } = extractTextAndTitle(viewRef.current)
          if (finalBody !== body || finalTitle !== title) {
            onSaveRef.current(nodeId, finalBody, finalTitle)
          }
        }
      }
      view.destroy()
      viewRef.current = null
    }
    // Only re-create the editor when the node ID changes, not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

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
  // Click handler — start editing
  // -----------------------------------------------------------------------

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!isEditing) {
        onStartEditing()
      }
    },
    [isEditing, onStartEditing],
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const cardClassName = `tapestry-note-card${isEditing ? ' tapestry-note-card--editing' : ''}`

  return (
    <div
      className={cardClassName}
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
      onClick={handleClick}
    >
      {title && <div className="tapestry-note-title">{title}</div>}
      <div className="tapestry-note-editor" ref={editorRef} />
    </div>
  )
}
