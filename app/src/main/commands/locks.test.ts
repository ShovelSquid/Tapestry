/**
 * Locks (02.4): how one aspect of a note resolves, and what an agent is told.
 *
 * The first block is pure: property maps and creator refs are written by hand
 * and the policy is passed explicitly, so every value of both constants is
 * exercised without flipping them.
 *
 * The second block runs through NoteCommands against the real kernel. Its
 * `lock.*` fixtures are written with a raw `submitAs`, because no command may
 * write them yet (D-08, Decision Register #19). Each refusal takes its
 * fingerprint only after the fixture commit, so the fixture is not mistaken
 * for a side effect of the refusal (D-11).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { makeTempDir } from '../../../test/helpers/temp-tree'
import { TreeRegistry, type OpenTree } from '../trees/registry'
import { agentActor, humanActor, type Actor } from './actor'
import {
  AGENT_NOTES_OPEN_TO_AGENTS,
  DEFAULT_LOCK_POLICY,
  NON_AGENT_NOTES_DELETE_LOCKED,
  allowKey,
  checkLock,
  isAgentActor,
  lockKey,
  resolveLock,
  type ActorLike,
  type LockPolicy,
  type LockProps,
} from './locks'
import { NoteCommands, docJsonToPlainText, plainTextToDocJson } from './notes'

// ---------------------------------------------------------------------------
// Pure resolution
// ---------------------------------------------------------------------------

const HUMAN_KAELEN: ActorLike = { kind: 'human', id: 'user.kaelen' }
const AGENT_CLAUDE: ActorLike = { kind: 'plugin', id: 'agent.claude' }
const AGENT_CHATGPT: ActorLike = { kind: 'plugin', id: 'agent.chatgpt' }

const ALL_POLICIES: LockPolicy[] = [
  { agentNotesOpenToAgents: true, nonAgentNotesDeleteLocked: true },
  { agentNotesOpenToAgents: true, nonAgentNotesDeleteLocked: false },
  { agentNotesOpenToAgents: false, nonAgentNotesDeleteLocked: true },
  { agentNotesOpenToAgents: false, nonAgentNotesDeleteLocked: false },
]

function textProp(value: string): LockProps[string] {
  return { type: 'text', value }
}

describe('resolveLock and checkLock (pure)', () => {
  it('builds the lock keys it reads', () => {
    expect(lockKey('text')).toBe('lock.text')
    expect(lockKey('delete')).toBe('lock.delete')
    expect(allowKey('text')).toBe('lock.text.allow')
    expect(allowKey('delete')).toBe('lock.delete.allow')
  })

  it('builds DEFAULT_LOCK_POLICY from the two named constants', () => {
    expect(DEFAULT_LOCK_POLICY).toEqual({
      agentNotesOpenToAgents: AGENT_NOTES_OPEN_TO_AGENTS,
      nonAgentNotesDeleteLocked: NON_AGENT_NOTES_DELETE_LOCKED,
    })
  })

  it('locks the text of a person\'s note to that person, whatever the policy', () => {
    for (const policy of ALL_POLICIES) {
      expect(resolveLock({}, HUMAN_KAELEN, 'text', policy)).toEqual({
        locked: true,
        owner: 'user.kaelen',
        allow: [],
      })
    }
  })

  it('locks delete of a person\'s note only when nonAgentNotesDeleteLocked is true', () => {
    expect(
      resolveLock({}, HUMAN_KAELEN, 'delete', {
        agentNotesOpenToAgents: true,
        nonAgentNotesDeleteLocked: true,
      }),
    ).toEqual({ locked: true, owner: 'user.kaelen', allow: [] })

    expect(
      resolveLock({}, HUMAN_KAELEN, 'delete', {
        agentNotesOpenToAgents: true,
        nonAgentNotesDeleteLocked: false,
      }),
    ).toEqual({ locked: false })
  })

  it('opens an agent\'s note to agents when agentNotesOpenToAgents is true', () => {
    const policy: LockPolicy = { agentNotesOpenToAgents: true, nonAgentNotesDeleteLocked: true }
    expect(resolveLock({}, AGENT_CLAUDE, 'text', policy)).toEqual({ locked: false })
    expect(resolveLock({}, AGENT_CLAUDE, 'delete', policy)).toEqual({ locked: false })
  })

  it('locks an agent\'s note to its creator when agentNotesOpenToAgents is false', () => {
    const policy: LockPolicy = { agentNotesOpenToAgents: false, nonAgentNotesDeleteLocked: false }
    expect(resolveLock({}, AGENT_CLAUDE, 'text', policy)).toEqual({
      locked: true,
      owner: 'agent.claude',
      allow: [],
    })
    expect(resolveLock({}, AGENT_CLAUDE, 'delete', policy)).toEqual({
      locked: true,
      owner: 'agent.claude',
      allow: [],
    })
  })

  it('locks the text of notes made by bridges, plugins, the system and legacy local (D-04)', () => {
    const creators: ActorLike[] = [
      { kind: 'plugin', id: 'obsidian.bridge' },
      { kind: 'plugin', id: 'tapestry-notes' },
      { kind: 'system', id: 'tapestry' },
      { kind: 'human', id: 'local' },
    ]
    for (const creator of creators) {
      expect(resolveLock({}, creator, 'text')).toEqual({
        locked: true,
        owner: creator.id,
        allow: [],
      })
    }
  })

  it('opens text on a person\'s note with an explicit `open`, leaving delete on its default', () => {
    const props: LockProps = { 'lock.text': textProp('open') }
    for (const policy of ALL_POLICIES) {
      expect(resolveLock(props, HUMAN_KAELEN, 'text', policy)).toEqual({ locked: false })
      expect(resolveLock(props, HUMAN_KAELEN, 'delete', policy)).toEqual(
        resolveLock({}, HUMAN_KAELEN, 'delete', policy),
      )
    }
  })

  it('locks an agent\'s note to an explicit owner whatever the policy', () => {
    const props: LockProps = { 'lock.text': textProp('agent.claude') }
    for (const policy of ALL_POLICIES) {
      expect(resolveLock(props, AGENT_CLAUDE, 'text', policy)).toEqual({
        locked: true,
        owner: 'agent.claude',
        allow: [],
      })
    }
  })

  it('fails closed on a non-text lock value, naming the raw value as owner', () => {
    expect(resolveLock({ 'lock.text': { type: 'int', value: 7 } }, AGENT_CLAUDE, 'text')).toEqual({
      locked: true,
      owner: '7',
      allow: [],
    })
    expect(
      resolveLock({ 'lock.text': { type: 'bool', value: true } }, AGENT_CLAUDE, 'text'),
    ).toEqual({ locked: true, owner: 'true', allow: [] })
  })

  it('does not let a ref-typed `open` unlock', () => {
    const state = resolveLock(
      { 'lock.text': { type: 'ref', value: 'open' } },
      AGENT_CLAUDE,
      'text',
    )
    expect(state.locked).toBe(true)
  })

  it('unlocks only on exactly `open`: case and padding stay locked', () => {
    for (const value of ['Open', ' open', 'open ']) {
      expect(resolveLock({ 'lock.text': textProp(value) }, AGENT_CLAUDE, 'text')).toEqual({
        locked: true,
        owner: value,
        allow: [],
      })
    }
  })

  it('keeps an empty or blank owner locked', () => {
    for (const value of ['', '   ']) {
      expect(resolveLock({ 'lock.text': textProp(value) }, AGENT_CLAUDE, 'text').locked).toBe(true)
    }
  })

  it('returns an empty allow list even when an allow property is present (Plan 02 reads it)', () => {
    const props: LockProps = {
      'lock.text': textProp('user.kaelen'),
      'lock.text.allow': textProp('agent.claude'),
    }
    expect(resolveLock(props, HUMAN_KAELEN, 'text')).toEqual({
      locked: true,
      owner: 'user.kaelen',
      allow: [],
    })
  })

  it('lets the lock owner write and refuses any other agent', () => {
    const props: LockProps = { 'lock.text': textProp('agent.claude') }
    expect(checkLock('n1', props, HUMAN_KAELEN, AGENT_CLAUDE, 'text')).toBeNull()
    expect(checkLock('n1', props, HUMAN_KAELEN, AGENT_CHATGPT, 'text')).toBe(
      'n1 text is locked by agent.claude',
    )
  })

  it('matches the owner exactly, never by prefix', () => {
    const props: LockProps = { 'lock.text': textProp('agent.claude') }
    expect(
      checkLock('n1', props, HUMAN_KAELEN, { kind: 'plugin', id: 'agent.claud' }, 'text'),
    ).toBe('n1 text is locked by agent.claude')
  })

  it('names the delete aspect in a delete refusal', () => {
    const props: LockProps = { 'lock.delete': textProp('user.kaelen') }
    expect(checkLock('n1', props, AGENT_CLAUDE, AGENT_CLAUDE, 'delete')).toBe(
      'n1 delete is locked by user.kaelen',
    )
  })

  it('shows an empty or blank owner as (unknown)', () => {
    for (const value of ['', '   ']) {
      const props: LockProps = { 'lock.text': textProp(value) }
      expect(checkLock('n1', props, HUMAN_KAELEN, AGENT_CLAUDE, 'text')).toBe(
        'n1 text is locked by (unknown)',
      )
    }
  })

  it('does not check people or non-agent plugins (D-10)', () => {
    const props: LockProps = { 'lock.text': textProp('agent.claude') }
    expect(checkLock('n1', props, HUMAN_KAELEN, HUMAN_KAELEN, 'text')).toBeNull()
    expect(
      checkLock('n1', props, HUMAN_KAELEN, { kind: 'plugin', id: 'tapestry-notes' }, 'text'),
    ).toBeNull()
  })

  it('recognises agents from journal-shaped actor refs', () => {
    expect(isAgentActor({ kind: 'plugin', id: 'agent.x' })).toBe(true)
    expect(isAgentActor({ kind: 'human', id: 'agent.x' })).toBe(false)
    expect(isAgentActor({ kind: 'plugin', id: 'agentx' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// End to end through NoteCommands
// ---------------------------------------------------------------------------

const CLAUDE = agentActor('claude')
const CHATGPT = agentActor('chatgpt')
const KAELEN = humanActor('kaelen')

let dir: string
let treePath: string
let registry: TreeRegistry
let tree: OpenTree
let notes: NoteCommands
let claudeNote: string

/** Write one `lock.*` fixture with a raw submit; no command may do this. */
function setLockProp(
  noteId: string,
  key: string,
  value: string | number | boolean,
  by: Actor = KAELEN,
  type = 'text',
): void {
  tree.bridge.submitAs(by, `set ${key}`, [
    { op: 'setProperty', target: noteId, key, type, value },
  ])
}

function worldFingerprint(): { size: number; nodes: number; edges: number } {
  return {
    size: statSync(treePath).size,
    nodes: tree.bridge.getNodes().length,
    edges: tree.bridge.getEdges().length,
  }
}

function lastCommitBlock(): string {
  const segments = readFileSync(treePath, 'utf-8').split(/^@commit /m)
  return segments[segments.length - 1]
}

function bodyTextOf(noteId: string): string {
  return docJsonToPlainText(String(tree.bridge.getNode(noteId)!.props['body']?.value ?? ''))
}

function titleOf(noteId: string): string {
  return String(tree.bridge.getNode(noteId)!.props['title']?.value ?? '')
}

describe('locks through NoteCommands', () => {
  beforeEach(() => {
    dir = makeTempDir('locks')
    treePath = join(dir, 'locks.tree')
    registry = new TreeRegistry()
    tree = registry.create(treePath, 'locks')
    notes = new NoteCommands(registry)

    tree.bridge.submitAs(KAELEN, 'Create note', [
      {
        op: 'createNode',
        type: 'tapestry.notes/note@1',
        props: {
          'position.x': { type: 'real', value: 0 },
          'position.y': { type: 'real', value: 0 },
          title: { type: 'text', value: 'Seed' },
          body: { type: 'text', value: plainTextToDocJson('Written by Kaelen') },
        },
      },
    ])

    const grown = notes.createFrom(CLAUDE, {
      tree: 'locks',
      grewFrom: 'n1',
      title: 'Luna',
      text: 'Grown by Claude',
    })
    if (!grown.ok) throw new Error(`setup failed: ${grown.error}`)
    claudeNote = grown.value.note
  })

  afterEach(() => {
    try {
      registry.closeAll()
    } catch {
      // Already closed.
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses another agent under an explicit text lock, and lets the owner write', () => {
    setLockProp(claudeNote, 'lock.text', 'agent.claude')
    const before = worldFingerprint()

    const refused = notes.updateNote(CHATGPT, {
      tree: 'locks',
      note: claudeNote,
      text: 'ChatGPT was here',
    })
    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.error).toBe(
      `${claudeNote} text is locked by agent.claude`,
    )
    expect(worldFingerprint()).toEqual(before)
    expect(bodyTextOf(claudeNote)).toBe('Grown by Claude')

    const allowed = notes.updateNote(CLAUDE, {
      tree: 'locks',
      note: claudeNote,
      text: 'Claude again',
    })
    expect(allowed.ok).toBe(true)
    expect(bodyTextOf(claudeNote)).toBe('Claude again')
    expect(lastCommitBlock()).toContain('actor plugin agent.claude')
  })

  it('lets an agent update a person\'s note whose text lock is `open`', () => {
    setLockProp('n1', 'lock.text', 'open')

    const result = notes.updateNote(CLAUDE, { tree: 'locks', note: 'n1', text: 'Opened up' })

    expect(result.ok).toBe(true)
    expect(bodyTextOf('n1')).toBe('Opened up')
  })

  it('fails closed on an int-typed text lock through the real kernel', () => {
    setLockProp(claudeNote, 'lock.text', 7, KAELEN, 'int')
    const before = worldFingerprint()

    const result = notes.updateNote(CLAUDE, {
      tree: 'locks',
      note: claudeNote,
      text: 'Should not land',
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe(`${claudeNote} text is locked by 7`)
    expect(worldFingerprint()).toEqual(before)
    expect(bodyTextOf(claudeNote)).toBe('Grown by Claude')
  })
  /** Aspects are independent (D-02, D-03): opening text leaves delete locked. */
  it('lets an agent update and rename under an open text lock, but refuses its delete', () => {
    setLockProp('n1', 'lock.text', 'open')
    setLockProp('n1', 'lock.delete', 'user.kaelen')

    const updated = notes.updateNote(CLAUDE, { tree: 'locks', note: 'n1', text: 'Opened up' })
    expect(updated.ok).toBe(true)

    const renamed = notes.renameNote(CLAUDE, { tree: 'locks', note: 'n1', title: 'Opened' })
    expect(renamed.ok).toBe(true)
    expect(titleOf('n1')).toBe('Opened')

    const before = worldFingerprint()
    const deleted = notes.deleteNote(CLAUDE, { tree: 'locks', note: 'n1' })
    expect(deleted.ok).toBe(false)
    expect(deleted.ok === false && deleted.error).toBe('n1 delete is locked by user.kaelen')
    expect(worldFingerprint()).toEqual(before)
    expect(tree.bridge.getNode('n1')).not.toBeNull()
  })

  /**
   * A delete lock alone leaves text writable. Claude's note is open under the
   * default, or agent.claude owns it, so update and rename pass for either
   * value of AGENT_NOTES_OPEN_TO_AGENTS.
   */
  it('lets an agent update and rename a note whose only lock is on delete, but refuses its delete', () => {
    setLockProp(claudeNote, 'lock.delete', 'user.kaelen')

    const updated = notes.updateNote(CLAUDE, {
      tree: 'locks',
      note: claudeNote,
      text: 'Still mine to edit',
    })
    expect(updated.ok).toBe(true)

    const renamed = notes.renameNote(CLAUDE, { tree: 'locks', note: claudeNote, title: 'Lunara' })
    expect(renamed.ok).toBe(true)
    expect(titleOf(claudeNote)).toBe('Lunara')

    const before = worldFingerprint()
    const deleted = notes.deleteNote(CLAUDE, { tree: 'locks', note: claudeNote })
    expect(deleted.ok).toBe(false)
    expect(deleted.ok === false && deleted.error).toBe(
      `${claudeNote} delete is locked by user.kaelen`,
    )
    expect(worldFingerprint()).toEqual(before)
    expect(tree.bridge.getNode(claudeNote)).not.toBeNull()
  })

  it('refuses a rename when the text lock belongs to someone else (D-03)', () => {
    setLockProp(claudeNote, 'lock.text', 'user.kaelen')
    const before = worldFingerprint()

    const result = notes.renameNote(CLAUDE, { tree: 'locks', note: claudeNote, title: 'Taken' })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toBe(
      `${claudeNote} text is locked by user.kaelen`,
    )
    expect(titleOf(claudeNote)).toBe('Luna')
    expect(worldFingerprint()).toEqual(before)
  })

  it('lets an agent delete a person\'s note whose delete lock is `open`', () => {
    setLockProp('n1', 'lock.delete', 'open')

    const result = notes.deleteNote(CLAUDE, { tree: 'locks', note: 'n1' })

    expect(result.ok).toBe(true)
    expect(tree.bridge.getNode('n1')).toBeNull()
  })
})
