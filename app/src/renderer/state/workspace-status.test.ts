/**
 * A workspace frame's watching status (02.7 D-06): what the header says for
 * each status, and a per-tree last status that a header mounted after the
 * event still sees.
 */

import { describe, expect, it } from 'vitest'
import { recordWorkspaceStatus, workspaceStatusFor, workspaceStatusLine } from './workspace-status'

describe('workspaceStatusLine', () => {
  it('says Watching, muted', () => {
    expect(workspaceStatusLine({ kind: 'watching' })).toEqual({ text: 'Watching', tone: 'muted' })
  })

  it('says why it is not watching, and that it will try again', () => {
    expect(workspaceStatusLine({ kind: 'not-watching', reason: 'FSEvents stream stopped' })).toEqual({
      text: 'Not watching -- FSEvents stream stopped. Tapestry will try again in 5 seconds.',
      tone: 'destructive',
    })
    // A reason that already ends a sentence does not get a second period.
    expect(workspaceStatusLine({ kind: 'not-watching', reason: 'Too many open files.' })?.text).toBe(
      'Not watching -- Too many open files. Tapestry will try again in 5 seconds.',
    )
  })

  it('says the folder is missing', () => {
    expect(workspaceStatusLine({ kind: 'folder-missing' })).toEqual({
      text: 'The folder is missing; nothing is being recorded.',
      tone: 'destructive',
    })
  })

  it('says nothing before any status is known', () => {
    expect(workspaceStatusLine(null)).toBeNull()
  })
})

describe('the per-tree last status', () => {
  it('keeps the latest status for each tree', () => {
    recordWorkspaceStatus({ treeId: 'tree-a', kind: 'watching' })
    recordWorkspaceStatus({ treeId: 'tree-b', kind: 'folder-missing' })
    recordWorkspaceStatus({ treeId: 'tree-a', kind: 'not-watching', reason: 'x' })
    expect(workspaceStatusFor('tree-a')).toEqual({ kind: 'not-watching', reason: 'x' })
    expect(workspaceStatusFor('tree-b')).toEqual({ kind: 'folder-missing' })
    expect(workspaceStatusFor('tree-c')).toBeNull()
  })
})
