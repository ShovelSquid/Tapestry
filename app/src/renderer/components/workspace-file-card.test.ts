/**
 * The memoised workspace card (02.7-06 scale): a refresh re-renders a card
 * only when its file, position, selection, zoom, open request or provenance
 * changed. Handlers are forwarded, so they never count.
 */

import { describe, expect, it } from 'vitest'
import { sameCardData } from './WorkspaceFileCard'

type Props = Parameters<typeof sameCardData>[0]

function props(overrides: Partial<Props> = {}, nodeProps: Record<string, string | number> = {}): Props {
  const base: Record<string, string | number> = {
    'file.path': 'src/a.ts',
    'file.sha256': 'a'.repeat(64),
    'file.text': 'text\n',
    'position.x': 10,
    'position.y': 20,
    ...nodeProps,
  }
  return {
    treeId: 'tree',
    node: {
      id: 'n1',
      type: 'tapestry.workspace/text@1',
      props: Object.fromEntries(
        Object.entries(base).map(([key, value]) => [key, { type: typeof value === 'number' ? 'number' : 'string', value }]),
      ),
    },
    isSelected: false,
    zoom: 1,
    provenance: {
      createdSeq: 1,
      createdBy: { kind: 'plugin', id: 'workspace.watcher' },
      changedSeq: 1,
      changedBy: { kind: 'plugin', id: 'workspace.watcher' },
      deletedSeq: null,
      deletedBy: null,
    },
    onBorderSelect: () => undefined,
    onHover: () => undefined,
    onPositionChange: () => undefined,
    onRegisterDims: () => undefined,
    ...overrides,
  }
}

describe('sameCardData', () => {
  it('skips a card whose data is equal, even with new node objects and new handlers', () => {
    expect(sameCardData(props(), props({ onHover: () => 1, onBorderSelect: () => 2 }))).toBe(true)
  })

  it('re-renders for a changed file, position, width, selection, zoom, open request or provenance', () => {
    const a = props()
    expect(sameCardData(a, props({}, { 'file.sha256': 'b'.repeat(64) }))).toBe(false)
    expect(sameCardData(a, props({}, { 'file.path': 'src/b.ts' }))).toBe(false)
    expect(sameCardData(a, props({}, { 'position.x': 11 }))).toBe(false)
    expect(sameCardData(a, props({}, { 'position.y': 21 }))).toBe(false)
    expect(sameCardData(a, props({}, { width: 300 }))).toBe(false)
    expect(sameCardData(a, props({ isSelected: true }))).toBe(false)
    expect(sameCardData(a, props({ zoom: 0.5 }))).toBe(false)
    expect(sameCardData(a, props({ openNonce: 3 }))).toBe(false)
    const changed = props()
    changed.provenance = { ...changed.provenance!, changedSeq: 9 }
    expect(sameCardData(a, changed)).toBe(false)
  })
})
