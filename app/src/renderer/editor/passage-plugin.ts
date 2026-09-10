/**
 * PassagePlugin -- ProseMirror plugin for passage hover tracking and
 * gradient-of-focus decorations (D-14).
 *
 * Tracks the document position under the pointer, identifies all passage
 * marks at that position, sorts them by span length (shortest first), and
 * applies CSS class decorations with descending opacity:
 *   - active  (innermost) : 25% accent bg + 80% bracket
 *   - level1  (next out)  : 15% accent bg + 50% bracket
 *   - level2+ (outer)     : 10% accent bg + 30% bracket
 *   - idle    (default)   : 8%  accent bg, no bracket
 *
 * Equal-length tiebreaker (UI-SPEC backstop): earlier in document order
 * (lower `from`) gets the stronger highlight.
 *
 * Exports:
 *   passagePluginKey  -- PluginKey for external state reads
 *   createPassagePlugin(onPassageHover?) -- factory returning the plugin
 *   getHoveredPassageAnchorId(view) -- read the active passage anchorId
 */

import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PassageInfo {
  anchorId: string
  from: number
  to: number
}

interface PassagePluginState {
  hoverPos: number | null
  allPassages: PassageInfo[]
  /** The anchorId of the innermost passage at hoverPos, or null. */
  activeAnchorId: string | null
}

// ---------------------------------------------------------------------------
// Plugin key
// ---------------------------------------------------------------------------

export const passagePluginKey = new PluginKey<PassagePluginState>('passage')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scan the entire document for passage marks and return their ranges.
 */
function collectPassages(doc: EditorState['doc']): PassageInfo[] {
  const passages: PassageInfo[] = []
  doc.descendants((node, pos) => {
    if (!node.isInline) return
    for (const mark of node.marks) {
      if (mark.type.name === 'passage' && mark.attrs.anchorId) {
        // Check if we already have an entry for this anchorId that we can extend
        const existing = passages.find((p) => p.anchorId === mark.attrs.anchorId)
        if (existing) {
          // Extend the range
          existing.from = Math.min(existing.from, pos)
          existing.to = Math.max(existing.to, pos + node.nodeSize)
        } else {
          passages.push({
            anchorId: mark.attrs.anchorId,
            from: pos,
            to: pos + node.nodeSize,
          })
        }
      }
    }
  })
  return passages
}

/**
 * Compute gradient-of-focus decorations from the current plugin state.
 */
function computeDecorations(
  doc: EditorState['doc'],
  state: PassagePluginState,
): DecorationSet {
  const { hoverPos, allPassages } = state
  const decorations: Decoration[] = []

  // Build a set of anchorIds that are "containing" the hover position
  // so we can skip adding idle decorations for them (they get level-specific ones)
  const containingIds = new Set<string>()

  if (hoverPos !== null) {
    const containing = allPassages
      .filter((p) => p.from <= hoverPos && p.to >= hoverPos)
      .sort((a, b) => {
        const lenDiff = (a.to - a.from) - (b.to - b.from)
        if (lenDiff !== 0) return lenDiff
        // Equal-length tiebreaker: earlier in document order wins
        return a.from - b.from
      })

    for (let i = 0; i < containing.length; i++) {
      const p = containing[i]
      containingIds.add(p.anchorId)
      const level = i === 0 ? 'active' : i === 1 ? 'level1' : 'level2'
      decorations.push(
        Decoration.inline(p.from, p.to, {
          class: `tapestry-passage-${level}`,
        }),
      )
    }
  }

  // All non-containing passages get the idle decoration
  for (const p of allPassages) {
    if (!containingIds.has(p.anchorId)) {
      decorations.push(
        Decoration.inline(p.from, p.to, {
          class: 'tapestry-passage-idle',
        }),
      )
    }
  }

  return DecorationSet.create(doc, decorations)
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the passage plugin instance.
 *
 * @param onPassageHover  Optional callback fired when the active (innermost)
 *                        passage at the pointer changes. Receives the anchorId
 *                        or null when the pointer leaves all passages.
 */
export function createPassagePlugin(
  onPassageHover?: (anchorId: string | null) => void,
): Plugin<PassagePluginState> {
  return new Plugin<PassagePluginState>({
    key: passagePluginKey,

    state: {
      init(_, editorState): PassagePluginState {
        const allPassages = collectPassages(editorState.doc)
        return { hoverPos: null, allPassages, activeAnchorId: null }
      },

      apply(tr, prev, _oldState, newState): PassagePluginState {
        let { hoverPos, allPassages, activeAnchorId } = prev

        // Rescan passages if the document changed
        if (tr.docChanged) {
          allPassages = collectPassages(newState.doc)
        }

        // Map hoverPos through transaction mapping
        if (hoverPos !== null && tr.docChanged) {
          hoverPos = tr.mapping.map(hoverPos)
        }

        // Accept setHoverPos meta
        const meta = tr.getMeta(passagePluginKey)
        if (meta !== undefined && meta !== null) {
          if ('hoverPos' in meta) {
            hoverPos = meta.hoverPos
          }
        }

        // Compute the new active anchorId
        let newActiveAnchorId: string | null = null
        if (hoverPos !== null) {
          const containing = allPassages
            .filter((p) => p.from <= hoverPos! && p.to >= hoverPos!)
            .sort((a, b) => {
              const lenDiff = (a.to - a.from) - (b.to - b.from)
              if (lenDiff !== 0) return lenDiff
              return a.from - b.from
            })
          if (containing.length > 0) {
            newActiveAnchorId = containing[0].anchorId
          }
        }

        // Fire callback if the active passage changed
        if (newActiveAnchorId !== activeAnchorId && onPassageHover) {
          onPassageHover(newActiveAnchorId)
        }

        return { hoverPos, allPassages, activeAnchorId: newActiveAnchorId }
      },
    },

    props: {
      handleDOMEvents: {
        mousemove(view: EditorView, event: MouseEvent) {
          const pos = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })
          const docPos = pos ? pos.pos : null
          const currentState = passagePluginKey.getState(view.state)
          if (currentState && currentState.hoverPos !== docPos) {
            const tr = view.state.tr.setMeta(passagePluginKey, {
              hoverPos: docPos,
            })
            tr.setMeta('addToHistory', false)
            view.dispatch(tr)
          }
          return false
        },
        mouseleave(view: EditorView) {
          const currentState = passagePluginKey.getState(view.state)
          if (currentState && currentState.hoverPos !== null) {
            const tr = view.state.tr.setMeta(passagePluginKey, {
              hoverPos: null,
            })
            tr.setMeta('addToHistory', false)
            view.dispatch(tr)
          }
          return false
        },
      },

      decorations(state: EditorState): DecorationSet {
        const pluginState = passagePluginKey.getState(state)
        if (!pluginState) return DecorationSet.empty
        return computeDecorations(state.doc, pluginState)
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Public reader
// ---------------------------------------------------------------------------

/**
 * Read the anchorId of the active (innermost) passage at hoverPos.
 * Returns null when nothing is hovered or no passage is at that position.
 */
export function getHoveredPassageAnchorId(
  view: EditorView,
): string | null {
  const state = passagePluginKey.getState(view.state)
  return state?.activeAnchorId ?? null
}
