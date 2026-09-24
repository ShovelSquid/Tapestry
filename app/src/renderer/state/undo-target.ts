/**
 * Where Ctrl+Z goes — pure functions, no React, no DOM.
 *
 * History is per journal, so "undo" has to mean one target. Right after a
 * frame drag that target is the forest's compensating frame undo (2.6 D-08,
 * D-09): the person just moved a frame, and that is what they expect back.
 * Otherwise it is a tree, in the precedence App has always used: the note
 * being edited or selected is the clearest statement of what the person is
 * working on; a selected frame outranks "the tree I last changed" but not the
 * note actually being edited or selected, which is more specific still; with
 * nothing selected, the tree they last changed is the next best answer, and
 * the only open tree is the answer when there is just one.
 */

/**
 * How far frame undo reaches.
 *
 * - `run`: consecutive frame moves form a run that Ctrl+Z walks back through,
 *   one move per press, before falling through to the tree.
 * - `single`: only the last frame move is undoable; the next press goes to the
 *   tree. A frame undo can still be redone once.
 */
export type FrameUndoReach = 'run' | 'single'

/**
 * The one place the reach choice lives. Plan 02's checkpoint (RESEARCH Open
 * Question 2) decides this value; changing it here changes the behaviour.
 */
export const FRAME_UNDO_REACH: FrameUndoReach = 'run'

/** How many frame moves Ctrl+Z and Ctrl+Shift+Z can currently reach. */
export interface FrameRun {
  undoable: number
  redoable: number
}

export const EMPTY_FRAME_RUN: FrameRun = Object.freeze({ undoable: 0, redoable: 0 })

export type FrameRunEvent =
  | 'frames-moved'
  | 'frames-undone'
  | 'frames-redone'
  | 'tree-edited'
  | 'selection-changed'
  | 'editing-started'
  | 'tree-undo'
  | 'tree-redo'

/**
 * The frame run after `event`.
 *
 * A frame move starts or extends the run and clears anything redoable. A
 * frame undo or redo moves one step between the two counts. Anything else the
 * person does (a note commit, a selection, starting to edit, a tree undo or
 * redo) ends the run: frame moves are no longer the last thing they did.
 */
export function nextFrameRun(
  run: FrameRun,
  event: FrameRunEvent,
  reach: FrameUndoReach = FRAME_UNDO_REACH,
): FrameRun {
  switch (event) {
    case 'frames-moved':
      return { undoable: reach === 'run' ? run.undoable + 1 : 1, redoable: 0 }

    case 'frames-undone':
      if (run.undoable <= 0) return run
      return reach === 'run'
        ? { undoable: run.undoable - 1, redoable: run.redoable + 1 }
        : { undoable: 0, redoable: 1 }

    case 'frames-redone':
      if (run.redoable <= 0) return run
      return { undoable: run.undoable + 1, redoable: run.redoable - 1 }

    default:
      return EMPTY_FRAME_RUN
  }
}

export type UndoTarget = { kind: 'frames' } | { kind: 'tree'; treeId: string } | null

export interface UndoTargetInput {
  direction: 'undo' | 'redo'
  frameRun: FrameRun
  editingTreeId: string | null
  selectedNoteTreeId: string | null
  selectedTreeId: string | null
  lastChangedTreeId: string | null
  firstTreeId: string | null
}

/** Which journal an undo or redo press acts on, or null when there is none. */
export function chooseUndoTarget(input: UndoTargetInput): UndoTarget {
  const framesReachable =
    input.direction === 'undo' ? input.frameRun.undoable > 0 : input.frameRun.redoable > 0
  if (framesReachable) return { kind: 'frames' }

  const treeId =
    input.editingTreeId ??
    input.selectedNoteTreeId ??
    input.selectedTreeId ??
    input.lastChangedTreeId ??
    input.firstTreeId ??
    null
  return treeId === null ? null : { kind: 'tree', treeId }
}
