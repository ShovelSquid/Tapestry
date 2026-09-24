/**
 * Ctrl+Z has to mean one journal. Right after a frame drag it means the
 * forest's compensating undo (2.6 D-08, D-09); otherwise it means the tree the
 * person is working on, in the precedence App has always used.
 *
 * The run reducer is what decides how long "right after a frame drag" lasts,
 * and both reach values are pinned here because Kaelen's checkpoint answer
 * picks one of them.
 */

import { describe, expect, it } from 'vitest'
import {
  EMPTY_FRAME_RUN,
  FRAME_UNDO_REACH,
  chooseUndoTarget,
  nextFrameRun,
  type FrameRun,
  type FrameRunEvent,
  type FrameUndoReach,
  type UndoTargetInput,
} from './undo-target'

type TreeIds = Omit<UndoTargetInput, 'direction' | 'frameRun'>

const noIds: TreeIds = {
  editingTreeId: null,
  selectedNoteTreeId: null,
  selectedTreeId: null,
  lastChangedTreeId: null,
  firstTreeId: null,
}

function undo(frameRun: FrameRun, ids: Partial<TreeIds> = {}) {
  return chooseUndoTarget({ direction: 'undo', frameRun, ...noIds, ...ids })
}

function redo(frameRun: FrameRun, ids: Partial<TreeIds> = {}) {
  return chooseUndoTarget({ direction: 'redo', frameRun, ...noIds, ...ids })
}

function run(events: FrameRunEvent[], reach: FrameUndoReach): FrameRun {
  return events.reduce((state, event) => nextFrameRun(state, event, reach), EMPTY_FRAME_RUN)
}

describe('chooseUndoTarget with no frame run', () => {
  it('follows editing note, selected note, selected frame, last changed, first tree', () => {
    const all = {
      editingTreeId: 'edit',
      selectedNoteTreeId: 'note',
      selectedTreeId: 'frame',
      lastChangedTreeId: 'last',
      firstTreeId: 'first',
    }
    expect(undo(EMPTY_FRAME_RUN, all)).toEqual({ kind: 'tree', treeId: 'edit' })
    expect(undo(EMPTY_FRAME_RUN, { ...all, editingTreeId: null })).toEqual({
      kind: 'tree',
      treeId: 'note',
    })
    expect(
      undo(EMPTY_FRAME_RUN, { ...all, editingTreeId: null, selectedNoteTreeId: null }),
    ).toEqual({ kind: 'tree', treeId: 'frame' })
    expect(
      undo(EMPTY_FRAME_RUN, {
        ...all,
        editingTreeId: null,
        selectedNoteTreeId: null,
        selectedTreeId: null,
      }),
    ).toEqual({ kind: 'tree', treeId: 'last' })
    expect(undo(EMPTY_FRAME_RUN, { firstTreeId: 'first' })).toEqual({
      kind: 'tree',
      treeId: 'first',
    })
  })

  it('returns null when there is no tree at all', () => {
    expect(undo(EMPTY_FRAME_RUN)).toBeNull()
    expect(redo(EMPTY_FRAME_RUN)).toBeNull()
  })
})

describe('chooseUndoTarget after a frame move', () => {
  it('sends undo to the frames, and a redo with nothing redoable to the tree chain', () => {
    const afterMove = nextFrameRun(EMPTY_FRAME_RUN, 'frames-moved')

    expect(undo(afterMove, { editingTreeId: 'edit' })).toEqual({ kind: 'frames' })
    expect(redo(afterMove, { selectedTreeId: 'frame' })).toEqual({
      kind: 'tree',
      treeId: 'frame',
    })
  })
})

describe("nextFrameRun with reach 'run'", () => {
  it('walks back through consecutive moves, then falls through to the tree', () => {
    const ids = { lastChangedTreeId: 'last' }
    let state = run(['frames-moved', 'frames-moved'], 'run')

    expect(undo(state, ids)).toEqual({ kind: 'frames' })
    state = nextFrameRun(state, 'frames-undone', 'run')
    expect(undo(state, ids)).toEqual({ kind: 'frames' })
    state = nextFrameRun(state, 'frames-undone', 'run')
    expect(undo(state, ids)).toEqual({ kind: 'tree', treeId: 'last' })

    // Both undone moves can be redone, one press each.
    expect(state).toEqual({ undoable: 0, redoable: 2 })
    state = nextFrameRun(state, 'frames-redone', 'run')
    expect(redo(state, ids)).toEqual({ kind: 'frames' })
    expect(state).toEqual({ undoable: 1, redoable: 1 })
  })
})

describe("nextFrameRun with reach 'single'", () => {
  it('reaches only the last move, and redoes it once', () => {
    const ids = { lastChangedTreeId: 'last' }
    let state = run(['frames-moved', 'frames-moved'], 'single')

    expect(undo(state, ids)).toEqual({ kind: 'frames' })
    state = nextFrameRun(state, 'frames-undone', 'single')
    expect(undo(state, ids)).toEqual({ kind: 'tree', treeId: 'last' })

    expect(redo(state, ids)).toEqual({ kind: 'frames' })
    state = nextFrameRun(state, 'frames-redone', 'single')
    expect(redo(state, ids)).toEqual({ kind: 'tree', treeId: 'last' })
  })
})

describe('nextFrameRun resets and bounds', () => {
  const resets: FrameRunEvent[] = [
    'tree-edited',
    'selection-changed',
    'editing-started',
    'tree-undo',
    'tree-redo',
  ]

  for (const reach of ['run', 'single'] as const) {
    for (const event of resets) {
      it(`${event} ends the run (reach ${reach})`, () => {
        const state = run(['frames-moved', 'frames-moved', 'frames-undone'], reach)
        expect(nextFrameRun(state, event, reach)).toEqual(EMPTY_FRAME_RUN)
      })
    }

    it(`a new move clears what was redoable (reach ${reach})`, () => {
      const state = run(['frames-moved', 'frames-undone', 'frames-moved'], reach)
      expect(state.redoable).toBe(0)
      expect(state.undoable).toBe(1)
    })

    it(`counts never go negative (reach ${reach})`, () => {
      const state = run(['frames-undone', 'frames-redone', 'frames-undone'], reach)
      expect(state.undoable).toBeGreaterThanOrEqual(0)
      expect(state.redoable).toBeGreaterThanOrEqual(0)
      expect(state).toEqual(EMPTY_FRAME_RUN)
    })
  }

  it('defaults to the one named reach', () => {
    expect(['run', 'single']).toContain(FRAME_UNDO_REACH)
    const twice = nextFrameRun(nextFrameRun(EMPTY_FRAME_RUN, 'frames-moved'), 'frames-moved')
    expect(twice.undoable).toBe(FRAME_UNDO_REACH === 'run' ? 2 : 1)
  })
})
