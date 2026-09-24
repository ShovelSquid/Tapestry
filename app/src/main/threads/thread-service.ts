/**
 * ThreadService — the single write authority for every open thread (D-06).
 *
 * One `ThreadService` instance, held by main, keeps one handle per open
 * thread: the authoritative ProseMirror document, its collab version, the
 * batch of records not yet flushed, and the flush timers. It is the only
 * thing that ever calls `KernelBridge.submitAs` for a thread's `thread.log`
 * or `body` keys — the renderer's collab plugin pushes steps here and never
 * touches the kernel directly.
 *
 * Flush cadence (D-06, Pitfall 1): idle 300ms OR a max-wait of ~1s OR a
 * detected time-out OR close OR an actor switch. The max-wait exists because
 * a continuous typist resets the idle timer on every keystroke and would
 * otherwise never get a commit — "a crash loses at most a moment" requires
 * the periodic flush regardless of whether typing ever pauses.
 *
 * Sessions (D-07, D-10, 02.3-06-PLAN.md Task 1): a per-thread timer, read
 * from the node's own `thread.timeout`/`thread.slowdown` properties at open,
 * fires `out` once `detectTimeout` (sessions.ts) says the gap since the last
 * applied step has actually elapsed, then flushes it immediately. The next
 * push() after that writes the `in` that opens the next session. Reopening
 * within the still-live timeout window resumes the same session rather than
 * minting a new one; reopening after it (deriveSessions finds the last
 * session unclosed and detectTimeout says it is in the past) means a crash
 * left the `out` unwritten, so the reader derives its boundary and this
 * service writes the missing `out` as its own commit on the very next write.
 */

import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { AddMarkStep, RemoveMarkStep, ReplaceStep, Step } from 'prosemirror-transform'
import { tapestrySchema } from '../../renderer/editor/schema'
import {
  formatBlock,
  parseBlock,
  parseBlockHeader,
  type ThreadCause,
  type ThreadRecord,
} from '../../shared/threads/grammar'
import { deriveSessions, detectTimeout, type AuthoredThreadRecord } from '../../shared/threads/sessions'
import { parseThreadSettings } from '../../shared/threads/settings'
import type { Actor } from '../commands/actor'
import type { KernelBridge } from '../kernel-bridge'

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

const IDLE_FLUSH_MS = 300
const MAX_WAIT_FLUSH_MS = 1000

// ---------------------------------------------------------------------------
// Public shapes (mirrored 1:1 by thread-ipc.ts over IPC)
// ---------------------------------------------------------------------------

export interface ThreadOpenResult {
  /** The collab version to start the renderer's `collab()` plugin at. */
  version: number
  /** ProseMirror JSON, replayed from `thread.log` records alone — never
   * the `body` checkpoint (that is what makes reopen honest: D-06). Falls
   * back to the `body` checkpoint alone when `unreadable` is true. */
  doc: unknown
  /** The number of `thread.log` values the addon returned on open — taken
   * up front, never an estimate (UI-SPEC "Loading and catch-up" rule 4). */
  totalChanges: number
  /** True when at least one `thread.log` value failed to parse (T-02.3-03-01):
   * `doc` is the last `body` checkpoint alone, and no write handle was
   * registered, so a `push` against this open refuses rather than building a
   * new commit on top of a history this process could not fully read. */
  unreadable?: boolean
  /** Present when `unreadable` is true: why the parse failed. */
  unreadableReason?: string
}

export type ThreadPushResult =
  | { confirmed: true; version: number }
  | { confirmed: false; missing: { steps: unknown[]; fromVersion: number } }
  | { confirmed: false; rejected: true; reason: string }

// ---------------------------------------------------------------------------
// Internal per-thread state
// ---------------------------------------------------------------------------

interface ThreadHandle {
  bridge: KernelBridge
  actor: Actor
  treeId: string
  nodeId: string

  doc: ProseMirrorNode
  version: number
  /** Every step ever applied, in version order, so a version-mismatched push
   * can be told exactly which steps it is missing (Pattern 3 rebase path). */
  steps: Step[]

  pending: ThreadRecord[]
  batchAnchorMs: number | null
  batchVersionBefore: number
  sessionStarted: boolean
  nextSessionNumber: number

  idleTimer: ReturnType<typeof setTimeout> | null
  maxWaitTimer: ReturnType<typeof setTimeout> | null

  /** D-10/D-13: this thread's own timeout, read from its node properties at
   * open. Never re-read afterwards -- a settings change from the popover
   * takes effect on the *next* open (the popover's own recorded-outcome
   * note: "New settings apply from now on"), which matches every other
   * per-thread setting's honesty rule (D-06/T-02.3-06-02): a live session
   * never has its already-running timeout window silently shortened or
   * lengthened out from under it mid-pause. */
  timeoutSeconds: number
  /** The moment (absolute ms) the current session's time-out timer counts
   * from -- the last applied step's own time, not `Date.now()` at schedule
   * time, so a resumed session (reopened within its old timeout window)
   * schedules for the *remaining* time rather than a fresh full window. */
  lastActivityMs: number | null
  /** Set at open() when the last session on disk has no closing `out` and
   * `detectTimeout` says it is unambiguously in the past (a crash) -- the
   * absolute moment that session's own last record actually happened.
   * Flushed as its own tiny `out`-only commit on the very next push(),
   * before that push's own batch (D-06: "the reader derives one, and the
   * service writes it on the next write"). */
  pendingDerivedOutMs: number | null
  timeoutTimer: ReturnType<typeof setTimeout> | null
}

// ---------------------------------------------------------------------------
// Replay: thread.log records -> a plain-text document (D-06 reopen path)
// ---------------------------------------------------------------------------

/**
 * Replays every `thread.log` block's `ins`/`del` records onto a single
 * growing string. Positions are the raw ProseMirror step positions the
 * grammar records (rule 1 of grammar.ts's header comment): for the flat,
 * single-paragraph document this tracer produces, position `p` in the
 * document is exactly index `p - 1` in this flat text, since an empty doc's
 * only paragraph starts at position 1.
 *
 * `mark+`/`mark-`/`step`/`marker`/`in`/`out` are not reflected here — full,
 * structure-aware replay (formatting, links, multi-paragraph documents) is
 * the LetterIndex/replay.ts module a later plan adds; this tracer only has
 * to prove the letters themselves survive a reopen.
 */
function replayFlatText(blocks: string[]): string {
  let text = ''
  for (const block of blocks) {
    for (const record of parseBlock(block)) {
      if (record.verb === 'ins') {
        const at = Math.max(0, Math.min(text.length, record.pos - 1))
        text = text.slice(0, at) + record.text + text.slice(at)
      } else if (record.verb === 'del') {
        const from = Math.max(0, Math.min(text.length, record.from - 1))
        const to = Math.max(from, Math.min(text.length, record.to - 1))
        text = text.slice(0, from) + text.slice(to)
      }
    }
  }
  return text
}

/** One paragraph per `\n`-separated line, matching use-prosemirror.ts's
 * plainTextToDoc so a thread's replayed text renders exactly like a note's
 * legacy plain-text body would. */
function docFromFlatText(text: string): ProseMirrorNode {
  if (text.length === 0) {
    return tapestrySchema.node('doc', null, [tapestrySchema.node('paragraph')])
  }
  const paragraphs = text
    .split('\n')
    .map((line) =>
      line ? tapestrySchema.node('paragraph', null, [tapestrySchema.text(line)]) : tapestrySchema.node('paragraph'),
    )
  return tapestrySchema.node('doc', null, paragraphs)
}

// ---------------------------------------------------------------------------
// Step -> record classification (Pattern 1 rules 2-3, Pattern 2 linesFor)
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isAttrlessMark(mark: { type: { spec: { attrs?: Record<string, unknown> } } }): boolean {
  const attrs = mark.type.spec.attrs
  return !attrs || Object.keys(attrs).length === 0
}

/**
 * Classifies one applied step into its grammar record, using `before` (the
 * document immediately prior to this step) to recover deleted text — the
 * same technique Pattern 2's `linesFor` uses in the renderer, run here
 * instead because main is the one applying steps and therefore the one that
 * actually has `before` and `after` in hand.
 */
function deriveRecord(step: Step, before: ProseMirrorNode, offsetMs: number, cause: ThreadCause | null): ThreadRecord {
  if (step instanceof ReplaceStep) {
    const { from, to, slice } = step
    const flat =
      slice.openStart === 0 &&
      slice.openEnd === 0 &&
      slice.content.childCount <= 1 &&
      (slice.content.childCount === 0 || slice.content.firstChild!.isText)

    if (flat) {
      const insertedNode = slice.content.firstChild
      const insertedText = insertedNode?.text ?? ''

      if (from === to && insertedText.length > 0) {
        const marks = insertedNode!.marks
        if (marks.every(isAttrlessMark)) {
          return {
            verb: 'ins',
            offsetMs,
            cause,
            pos: from,
            text: insertedText,
            marks: marks.map((m) => m.type.name),
          }
        }
      } else if (insertedText.length === 0 && from < to) {
        return { verb: 'del', offsetMs, cause, from, to, text: before.textBetween(from, to, '\n') }
      }
    }

    const readable = from < to ? before.textBetween(from, to, '\n') : slice.content.textBetween(0, slice.content.size, '\n')
    return { verb: 'step', offsetMs, cause, stepJson: JSON.stringify(step.toJSON()), text: readable }
  }

  if (step instanceof AddMarkStep) {
    if (isAttrlessMark(step.mark)) {
      return { verb: 'mark+', offsetMs, cause, mark: step.mark.type.name, from: step.from, to: step.to }
    }
    return {
      verb: 'step',
      offsetMs,
      cause,
      stepJson: JSON.stringify(step.toJSON()),
      text: before.textBetween(step.from, step.to, '\n'),
    }
  }

  if (step instanceof RemoveMarkStep) {
    if (isAttrlessMark(step.mark)) {
      return { verb: 'mark-', offsetMs, cause, mark: step.mark.type.name, from: step.from, to: step.to }
    }
    return {
      verb: 'step',
      offsetMs,
      cause,
      stepJson: JSON.stringify(step.toJSON()),
      text: before.textBetween(step.from, step.to, '\n'),
    }
  }

  // ReplaceAroundStep, AddNodeMarkStep, RemoveNodeMarkStep and anything else
  // the schema can produce: readable only as an exact step (rule 3).
  return { verb: 'step', offsetMs, cause, stepJson: JSON.stringify(step.toJSON()), text: '' }
}

// ---------------------------------------------------------------------------
// ThreadService
// ---------------------------------------------------------------------------

export class ThreadService {
  private handles = new Map<string, ThreadHandle>()

  /** Fired after a batch is durably committed, so main can broadcast
   * `thread:confirmed` and the overlay can retire "Saving…". */
  onFlush: ((treeId: string, nodeId: string, version: number) => void) | null = null

  /** Fired when a flush is refused (T-02.3-02-06): the batch stays pending
   * and keeps retrying, but the overlay must show "Not saved", not "Saving…"
   * forever. */
  onFlushError: ((treeId: string, nodeId: string, reason: string) => void) | null = null

  private key(treeId: string, nodeId: string): string {
    return `${treeId}\u0000${nodeId}`
  }

  /**
   * Opens a thread for editing.
   *
   * Reconciles a rewound world to its head first (Pitfall 2): a commit is
   * refused while history is rewound, and a thread typing session must never
   * discover that on its first flush. Every `thread.log` value is then read
   * and replayed into the authoritative document — never the `body`
   * checkpoint, which is what makes "read from thread.log records alone" true
   * after a reopen.
   */
  open(bridge: KernelBridge, actor: Actor, treeId: string, nodeId: string): ThreadOpenResult {
    const key = this.key(treeId, nodeId)
    const existing = this.handles.get(key)
    if (existing) {
      return {
        version: existing.version,
        doc: existing.doc.toJSON(),
        totalChanges: bridge.getPropertyValues(nodeId, 'thread.log').length,
      }
    }

    if (bridge.isRewound) {
      bridge.discardRedo()
    }

    const entries = bridge.getPropertyValues(nodeId, 'thread.log')
    const blocks = entries.map((entry) => String(entry.value.value))
    const node = bridge.getNode(nodeId)
    const timeoutSeconds = parseThreadSettings(node?.props ?? {}).timeout

    let doc: ProseMirrorNode
    let version = 0
    const authoredRecords: AuthoredThreadRecord[] = []
    try {
      doc = docFromFlatText(replayFlatText(blocks))
      for (const entry of entries) {
        const block = String(entry.value.value)
        const header = parseBlockHeader(block)
        const records = parseBlock(block)
        const stepCount = records.filter((r) => r.verb !== 'in' && r.verb !== 'out').length
        version = header.versionBefore + stepCount
        for (const record of records) {
          authoredRecords.push({ ...record, atMs: header.anchorMs + record.offsetMs, actor: entry.actor.id })
        }
      }
    } catch (err) {
      // A malformed thread.log must never become the base for a new commit
      // (T-02.3-03-01): no handle is registered below, so a push against
      // this open refuses ("Thread not open") rather than building on a
      // half-read history. The fallback document is the last body
      // checkpoint alone -- the same text PLUG-04's FallbackNodeView shows
      // with the plugin disabled entirely, so a thread degrades to the same
      // honest state whether the plugin is missing or its history cannot be
      // parsed.
      const checkpointText = node ? String(node.props.body?.value ?? '') : ''
      return {
        version: 0,
        doc: docFromFlatText(checkpointText).toJSON(),
        totalChanges: entries.length,
        unreadable: true,
        unreadableReason: errorMessage(err),
      }
    }

    // Recorded outcomes (D-07/T-02.3-06-02): reconstruct sessions from the
    // records that exist, never from timestamps and the current setting.
    const sessions = deriveSessions(authoredRecords)
    const lastSession = sessions[sessions.length - 1] ?? null

    let sessionStarted = false
    let nextSessionNumber = sessions.length + 1
    let lastActivityMs: number | null = null
    let pendingDerivedOutMs: number | null = null

    if (lastSession && !lastSession.closed) {
      if (detectTimeout(lastSession.endMs, Date.now(), timeoutSeconds)) {
        // Unambiguously in the past: a crash left this session's `out`
        // unwritten. The reader derives the boundary at the session's own
        // last known moment; ThreadService writes it on the very next write.
        pendingDerivedOutMs = lastSession.endMs
      } else {
        // Still inside the timeout window: closing and reopening a thread
        // is not itself a time-out (D-07). Resume this same session rather
        // than minting a new one.
        sessionStarted = true
        nextSessionNumber = lastSession.index
        lastActivityMs = lastSession.endMs
      }
    }

    const handle: ThreadHandle = {
      bridge,
      actor,
      treeId,
      nodeId,
      doc,
      version,
      steps: [],
      pending: [],
      batchAnchorMs: null,
      batchVersionBefore: version,
      sessionStarted,
      nextSessionNumber,
      idleTimer: null,
      maxWaitTimer: null,
      timeoutSeconds,
      lastActivityMs,
      pendingDerivedOutMs,
      timeoutTimer: null,
    }
    this.handles.set(key, handle)
    if (sessionStarted) {
      // A resumed session's timer must count down from the *remaining* time
      // (schedule reads handle.lastActivityMs), not a fresh full window.
      this.scheduleTimeout(handle)
    }

    return { version, doc: doc.toJSON(), totalChanges: entries.length }
  }

  /**
   * Applies a batch of steps sent by the renderer's collab plugin.
   *
   * A version mismatch replies with the steps the caller is missing, for
   * `receiveTransaction` to rebase locally (Pattern 3) — nothing is applied
   * in that case. A step whose `apply()` fails rejects the whole push and
   * commits nothing (T-02.3-02-03): steps already applied earlier in the
   * same push are rolled back by simply never being written back to the
   * handle, since this method only touches `handle.*` after every step in
   * the batch has succeeded.
   */
  push(
    treeId: string,
    nodeId: string,
    actor: Actor,
    version: number,
    stepsJson: unknown[],
    timesMs: number[],
    causes: (ThreadCause | null)[],
  ): ThreadPushResult {
    const handle = this.handles.get(this.key(treeId, nodeId))
    if (!handle) {
      throw new Error(`Thread not open: ${treeId} ${nodeId}`)
    }

    // D-06/D-07: a session that crashed before its `out` could be written is
    // repaired on the very next write, as its own tiny commit landing before
    // this push's own batch -- never folded into it, so the recovered `out`
    // keeps the crashed session's own honest moment rather than borrowing
    // this write's anchor.
    if (handle.pendingDerivedOutMs !== null) {
      const outBlock = formatBlock([{ verb: 'out', offsetMs: 0 }], handle.pendingDerivedOutMs, handle.version)
      try {
        handle.bridge.submitAs(actor, 'Thread recovered time-out', [
          { op: 'setProperty', target: handle.nodeId, key: 'thread.log', type: 'text', value: outBlock },
        ])
      } catch (err) {
        console.error('[ThreadService] failed to write recovered out record:', err)
      }
      handle.pendingDerivedOutMs = null
    }

    // D-06: a commit never mixes authors. An actor switch flushes whatever
    // the previous author left pending before this author's steps join it.
    if (handle.pending.length > 0 && handle.actor.id !== actor.id) {
      this.flush(handle)
    }
    handle.actor = actor

    if (version !== handle.version) {
      return {
        confirmed: false,
        missing: { steps: handle.steps.slice(version).map((s) => s.toJSON()), fromVersion: version },
      }
    }

    const startingNewBatch = handle.pending.length === 0
    const anchorMs = startingNewBatch ? timesMs[0] ?? Date.now() : handle.batchAnchorMs!

    const newRecords: ThreadRecord[] = []
    if (startingNewBatch && !handle.sessionStarted) {
      newRecords.push({ verb: 'in', offsetMs: 0, session: handle.nextSessionNumber })
      handle.sessionStarted = true
    }

    let doc = handle.doc
    const stepRecords: ThreadRecord[] = []
    const appliedSteps: Step[] = []

    for (let i = 0; i < stepsJson.length; i++) {
      let step: Step
      try {
        step = Step.fromJSON(tapestrySchema, stepsJson[i])
      } catch (err) {
        // A malformed step (bad shape, unknown step type) never reaches
        // apply() at all (T-02.3-02-03/05): reject the whole push, commit
        // nothing already accumulated from earlier steps in this same push.
        return { confirmed: false, rejected: true, reason: errorMessage(err) }
      }
      const before = doc
      // step.apply() itself can throw rather than returning a failed
      // StepResult -- prosemirror-transform's ReplaceStep resolves its
      // positions against `before` and throws RangeError for an out-of-range
      // or otherwise invalid position instead of returning StepResult.fail().
      // Both outcomes mean the same thing here: reject, commit nothing.
      let result
      try {
        result = step.apply(before)
      } catch (err) {
        return { confirmed: false, rejected: true, reason: errorMessage(err) }
      }
      if (result.failed) {
        return { confirmed: false, rejected: true, reason: result.failed }
      }
      const offsetMs = Math.max(0, (timesMs[i] ?? anchorMs) - anchorMs)
      stepRecords.push(deriveRecord(step, before, offsetMs, causes[i] ?? null))
      appliedSteps.push(step)
      doc = result.doc!
    }

    if (startingNewBatch) {
      handle.batchAnchorMs = anchorMs
      handle.batchVersionBefore = handle.version
    }
    handle.pending.push(...newRecords, ...stepRecords)
    handle.steps.push(...appliedSteps)
    handle.doc = doc
    handle.version += stepsJson.length
    handle.lastActivityMs = timesMs[timesMs.length - 1] ?? Date.now()

    this.scheduleFlush(handle)
    this.scheduleTimeout(handle)

    return { confirmed: true, version: handle.version }
  }

  /** Flushes the pending batch (if any) and writes the `body` checkpoint,
   * then forgets the handle. Called when the overlay closes. */
  close(treeId: string, nodeId: string): void {
    const key = this.key(treeId, nodeId)
    const handle = this.handles.get(key)
    if (!handle) return

    this.flush(handle)

    try {
      handle.bridge.submitAs(handle.actor, 'Thread checkpoint', [
        {
          op: 'setProperty',
          target: handle.nodeId,
          key: 'body',
          type: 'text',
          value: JSON.stringify(handle.doc.toJSON()),
        },
      ])
    } catch (err) {
      console.error('[ThreadService] checkpoint write failed on close:', err)
    }

    if (handle.idleTimer) clearTimeout(handle.idleTimer)
    if (handle.maxWaitTimer) clearTimeout(handle.maxWaitTimer)
    if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer)
    this.handles.delete(key)
  }

  /** Closes every open thread (app quit): a clean exit should lose nothing,
   * not merely "at most a moment" (D-06). */
  closeAll(): void {
    for (const handle of [...this.handles.values()]) {
      this.close(handle.treeId, handle.nodeId)
    }
  }

  private scheduleFlush(handle: ThreadHandle): void {
    if (handle.idleTimer) clearTimeout(handle.idleTimer)
    handle.idleTimer = setTimeout(() => this.flush(handle), IDLE_FLUSH_MS)
    if (!handle.maxWaitTimer) {
      handle.maxWaitTimer = setTimeout(() => this.flush(handle), MAX_WAIT_FLUSH_MS)
    }
  }

  /**
   * (Re)schedules the D-10 time-out timer for the *remaining* window from
   * `handle.lastActivityMs` -- so a reopen that resumed a session (open()'s
   * "still inside the timeout window" branch) counts down the time actually
   * left, never a fresh full `timeoutSeconds`. Called after every push() and
   * once from open() when a session is resumed.
   */
  private scheduleTimeout(handle: ThreadHandle): void {
    if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer)
    const lastActivity = handle.lastActivityMs ?? Date.now()
    const elapsedMs = Date.now() - lastActivity
    const delayMs = Math.max(0, handle.timeoutSeconds * 1000 - elapsedMs)
    handle.timeoutTimer = setTimeout(() => this.handleTimeout(handle), delayMs)
  }

  /**
   * The time-out is one of this thread's flush triggers (D-06/D-07,
   * RESEARCH's five triggers: idle, max-wait, time-out, close, actor
   * switch). Fires only when `detectTimeout` still agrees a full timeout
   * has actually elapsed against `lastActivityMs` -- a timer that fired a
   * little early (setTimeout drift, or a `scheduleTimeout` call that raced
   * a fresher `lastActivityMs`) reschedules for the true remaining time
   * instead of writing an `out` too soon.
   */
  private handleTimeout(handle: ThreadHandle): void {
    handle.timeoutTimer = null
    if (!handle.sessionStarted) return // Already ended, or never started.

    const lastActivity = handle.lastActivityMs ?? Date.now()
    if (!detectTimeout(lastActivity, Date.now(), handle.timeoutSeconds)) {
      this.scheduleTimeout(handle)
      return
    }

    const nowMs = Date.now()
    const startingNewBatch = handle.pending.length === 0
    if (startingNewBatch) {
      handle.batchAnchorMs = nowMs
      handle.batchVersionBefore = handle.version
    }
    const anchorMs = handle.batchAnchorMs ?? nowMs
    handle.pending.push({ verb: 'out', offsetMs: Math.max(0, nowMs - anchorMs) })
    handle.sessionStarted = false
    handle.nextSessionNumber += 1
    this.flush(handle)
  }

  private flush(handle: ThreadHandle): void {
    if (handle.idleTimer) {
      clearTimeout(handle.idleTimer)
      handle.idleTimer = null
    }
    if (handle.maxWaitTimer) {
      clearTimeout(handle.maxWaitTimer)
      handle.maxWaitTimer = null
    }
    if (handle.pending.length === 0) return

    const block = formatBlock(handle.pending, handle.batchAnchorMs ?? Date.now(), handle.batchVersionBefore)
    const ops = [{ op: 'setProperty', target: handle.nodeId, key: 'thread.log', type: 'text', value: block }]

    try {
      handle.bridge.submitAs(handle.actor, 'Thread batch', ops)
    } catch (err) {
      // A refused flush (e.g. a momentary rewind) must be visible as "Not
      // saved" rather than a silently dropped batch (T-02.3-02-06) -- the
      // batch itself is retained and retried, so nothing already typed is
      // lost, but the overlay must stop implying it is safely on disk.
      console.error('[ThreadService] flush failed, batch retained for retry:', err)
      this.onFlushError?.(handle.treeId, handle.nodeId, errorMessage(err))
      this.scheduleFlush(handle)
      return
    }

    handle.pending = []
    this.onFlush?.(handle.treeId, handle.nodeId, handle.version)
  }
}
