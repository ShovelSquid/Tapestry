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
 * Flush cadence (D-06, Pitfall 1): idle 300ms OR a max-wait of ~1s OR close
 * OR an actor switch. The max-wait exists because a continuous typist resets
 * the idle timer on every keystroke and would otherwise never get a commit —
 * "a crash loses at most a moment" requires the periodic flush regardless of
 * whether typing ever pauses.
 *
 * Sessions in this plan are minimal by design (02.3-02-PLAN.md Task 2): one
 * `in` record opens the first batch of a thread's lifetime in this process;
 * time-out detection and `out` records are Plan 04's job.
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
   * the `body` checkpoint (that is what makes reopen honest: D-06). */
  doc: unknown
  /** The number of `thread.log` values the addon returned on open — taken
   * up front, never an estimate (UI-SPEC "Loading and catch-up" rule 4). */
  totalChanges: number
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
    const doc = docFromFlatText(replayFlatText(blocks))

    let version = 0
    let sessionCount = 0
    for (const block of blocks) {
      const header = parseBlockHeader(block)
      const records = parseBlock(block)
      const stepCount = records.filter((r) => r.verb !== 'in' && r.verb !== 'out').length
      version = header.versionBefore + stepCount
      sessionCount += records.filter((r) => r.verb === 'in').length
    }

    this.handles.set(key, {
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
      sessionStarted: false,
      nextSessionNumber: sessionCount + 1,
      idleTimer: null,
      maxWaitTimer: null,
    })

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

    this.scheduleFlush(handle)

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
