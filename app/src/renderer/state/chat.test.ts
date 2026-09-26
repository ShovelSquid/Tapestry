/**
 * Ways into the chat (02.7 D-19): what an attachment says, how it joins the
 * first message, and which workspace a click opens the chat for.
 */

import { describe, expect, it } from 'vitest'
import { chatWorkspaceFor, composeFirstMessage, formatAttachment, liveAfter, type ChatAttachment } from './chat'

const WS_A = `sha256:${'a'.repeat(64)}`
const WS_B = `sha256:${'b'.repeat(64)}`
const NATIVE = `sha256:${'c'.repeat(64)}`

const fileAttachment: ChatAttachment = {
  kind: 'file',
  workspaceTreeId: WS_A,
  workspaceName: 'windows',
  path: 'app/src/main/index.ts',
}

const noteAttachment: ChatAttachment = {
  kind: 'note',
  treeId: NATIVE,
  treeName: 'we',
  noteId: 'n12',
  title: 'Seed',
}

describe('formatAttachment', () => {
  it('names a file and its workspace', () => {
    expect(formatAttachment(fileAttachment)).toBe(
      'Context: the file app/src/main/index.ts in the workspace windows.',
    )
  })

  it('names a note, its title and its tree, and says how to read it', () => {
    expect(formatAttachment(noteAttachment)).toBe(
      `Context: the note n12 "Seed" in the tree we (${NATIVE}). Read it with read_note.`,
    )
  })

  it('escapes quotes and flattens newlines in a note title', () => {
    expect(formatAttachment({ ...noteAttachment, title: 'A "big"\nidea\r\nhere' })).toBe(
      `Context: the note n12 "A \\"big\\" idea here" in the tree we (${NATIVE}). Read it with read_note.`,
    )
  })
})

describe('composeFirstMessage', () => {
  it('puts the attachment line, a blank line, then the text', () => {
    expect(composeFirstMessage(fileAttachment, 'why?')).toBe(
      'Context: the file app/src/main/index.ts in the workspace windows.\n\nwhy?',
    )
  })

  it('leaves the text alone with no attachment', () => {
    expect(composeFirstMessage(null, 'why?')).toBe('why?')
  })
})

describe('chatWorkspaceFor', () => {
  const both = [
    { id: WS_A, name: 'windows', kind: 'workspace' as const },
    { id: WS_B, name: 'physics', kind: 'workspace' as const },
    { id: NATIVE, name: 'we', kind: 'native' as const },
  ]
  const onlyA = [both[0], both[2]]

  it("uses a file attachment's workspace first", () => {
    expect(chatWorkspaceFor({ treeId: WS_B, attachment: fileAttachment }, both, WS_B)).toEqual({
      treeId: WS_A,
    })
  })

  it('uses the workspace that was clicked in', () => {
    expect(chatWorkspaceFor({ treeId: WS_B }, both, WS_A)).toEqual({ treeId: WS_B })
    expect(chatWorkspaceFor({ treeId: WS_B, attachment: noteAttachment }, both, WS_A)).toEqual({
      treeId: WS_B,
    })
  })

  it('falls back to the last chat while its workspace is still open', () => {
    expect(chatWorkspaceFor({ treeId: NATIVE, attachment: noteAttachment }, both, WS_B)).toEqual({
      treeId: WS_B,
    })
    expect(chatWorkspaceFor({}, onlyA, WS_B)).toEqual({ treeId: WS_A })
  })

  it('uses the only open workspace', () => {
    expect(chatWorkspaceFor({}, onlyA, null)).toEqual({ treeId: WS_A })
  })

  it('asks which one when several are open', () => {
    expect(chatWorkspaceFor({ treeId: NATIVE }, both, null)).toEqual({
      choose: [
        { treeId: WS_A, name: 'windows' },
        { treeId: WS_B, name: 'physics' },
      ],
    })
  })

  it('says none when no workspace is open', () => {
    expect(chatWorkspaceFor({}, [both[2]], WS_A)).toEqual({ none: true })
    expect(chatWorkspaceFor({ attachment: fileAttachment }, [], null)).toEqual({ none: true })
  })
})

describe('liveAfter (02.8-01, D-09)', () => {
  const entries = [
    { turn: 1, event: { type: 'user' as const, text: 'one' } },
    { turn: 1, event: { type: 'done' as const, ok: true } },
    { turn: 2, event: { type: 'notice' as const, text: 'shell on' } },
    { turn: 2, event: { type: 'user' as const, text: 'two' } },
  ]

  it('keeps only the turns the note does not hold yet', () => {
    expect(liveAfter(entries, 0)).toEqual(entries)
    expect(liveAfter(entries, 1)).toEqual(entries.slice(2))
    expect(liveAfter(entries, 2)).toEqual([])
  })
})
