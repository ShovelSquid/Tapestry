/**
 * The bridge (kinds 1..4 into mathspace actions) over the committed
 * .actions fixtures: every fixture action translates and applies, the
 * rule never skips, every stroke the bridge lists has a body note with a
 * target, and the node table the bridge counts is the one in the world.
 * Until 7f these ran in lockstep with ddsim.wasm and compared the body
 * and every emitted node bit for bit; ddsim is gone, and that equality
 * lives on as the recorded goldens (wasm-golden.test.ts: the .sha256
 * files were written from the bridged engine while it was bit-equal to
 * ddsim's body and node table). The rejection codes below are the DD_ERR
 * values ddsim answered, recorded. The module comes from surface/wasm/
 * (`npm run sim:wasm`); a mock would prove nothing here.
 *
 * Only the one-sample-per-tick fixtures are replayed here: the bridge
 * keeps one engine step per tick (STATE.md Decisions), so `four-per-tick`
 * follows a different path from ddsim's by design.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import createMathspace from '../wasm/mathspace.mjs'
import {
  BODY_STRIDE,
  INK_BRUSH,
  NODE_STRIDE,
  encodeDefineBrush,
  encodeStrokeBegin,
  encodeStrokeEnd,
  encodeStrokeSamples,
  strokeIdOf,
} from '../src/ddsim-abi'
import { MsEngine, decodeSnapshot, fxFromQ16, FX_ONE, type MathspaceModule } from '../src/ms-abi'
import {
  BODY_INDEX,
  BODY_RULE_ID,
  BODY_SPACE_ID,
  BridgeError,
  MsBridge,
  NODE_SPACE_ID,
  bodyNoteId,
  makeNodeId,
} from '../src/ms-bridge'
import { parseActions, type Fixture } from './fixture-replay'

const GOLDEN_DIR = fileURLToPath(new URL('./golden/', import.meta.url))
const ONE_SAMPLE_FIXTURES = ['one-stroke', 'two-strokes', 'gap', 'two-strokes-inserted', 'brush-edit'] as const

let mathspacePromise: Promise<MathspaceModule> | null = null
function loadMathspace(): Promise<MathspaceModule> {
  const p = mathspacePromise ?? createMathspace()
  mathspacePromise = p
  return p
}

/** The emitted nodes of the mathspace world: every note above the setup ids that is not a body. */
function msNodes(notes: ReturnType<MsEngine['notes']>): Map<bigint, Map<string, bigint[]>> {
  const out = new Map<bigint, Map<string, bigint[]>>()
  for (const [id, fields] of notes) {
    if (id <= NODE_SPACE_ID || (id & 0xffffffn) === BigInt(BODY_INDEX)) continue
    out.set(id, fields)
  }
  return out
}

/**
 * Replays `fixture` through the bridge into the engine. Returns the number
 * of (tick, stroke) body checks made and the node count at the end, and
 * throws on the first refusal or skip with the tick in the message.
 */
function replayThroughBridge(ms: MathspaceModule, fixture: Fixture): { compared: number; nodes: number } {
  const engine = new MsEngine(ms, fixture.seed)
  const bridge = new MsBridge()
  let compared = 0
  let nodes = 0
  const seen = new Set<bigint>()
  try {
    MsBridge.bootstrap(engine)
    let max = 0
    for (const a of fixture.actions) max = Math.max(max, a.tick)
    for (const c of fixture.checkpoints) max = Math.max(max, c)
    for (let t = 0; t <= max; t++) {
      for (const a of fixture.actions) {
        if (a.tick !== t) continue
        const tr = bridge.translate(a.bytes, t)
        expect(tr.code, `tick ${t}: the bridge refused a fixture action`).toBe(0)
        for (const act of tr.actions) {
          expect(engine.apply(act), `tick ${t}: mathspace rejected a bridge action`).toBe(0)
        }
      }
      engine.step()
      expect(engine.errors(), `tick ${t}: the rule skipped something`).toEqual([])
      for (const act of bridge.afterStep(engine.notes(), t)) {
        expect(engine.apply(act), `tick ${t}: mathspace rejected an emission action`).toBe(0)
      }
      const notes = engine.notes()
      const table = msNodes(notes)
      // Emitted nodes are never changed or deleted: the table only grows.
      for (const id of seen) expect(table.has(id), `tick ${t}: node ${id} vanished`).toBe(true)
      for (const id of table.keys()) seen.add(id)
      expect(bridge.nodeCount, `tick ${t}: bridge node count`).toBe(table.size)
      nodes = table.size
      for (const st of bridge.strokes.values()) {
        const note = notes.get(bodyNoteId(st.id))
        expect(note, `tick ${t}: mathspace has no body note for stroke ${st.id}`).toBeDefined()
        if (!st.hasTarget) continue
        expect(note!.get('pos'), `tick ${t} stroke ${st.id}: pos`).toHaveLength(2)
        expect(note!.get('velocity'), `tick ${t} stroke ${st.id}: velocity`).toHaveLength(2)
        expect(note!.get('target'), `tick ${t} stroke ${st.id}: target`).toHaveLength(2)
        compared++
      }
      // A body note in the world is a stroke the bridge still lists, and vice versa.
      const bodies = [...notes.keys()].filter((id) => id > NODE_SPACE_ID && (id & 0xffffffn) === BigInt(BODY_INDEX))
      expect(bodies.sort(), `tick ${t}: active strokes`).toEqual([...bridge.strokes.keys()].map(bodyNoteId).sort())
    }
  } finally {
    engine.destroy()
  }
  return { compared, nodes }
}

describe('ms-bridge: the fixtures replay through the bridge', () => {
  for (const name of ONE_SAMPLE_FIXTURES) {
    it(`${name}: every action applies, no skips, one body note per active stroke, the node table grows`, async () => {
      const ms = await loadMathspace()
      const fixture = parseActions(readFileSync(join(GOLDEN_DIR, `${name}.actions`), 'utf8'))
      const { compared, nodes } = replayThroughBridge(ms, fixture)
      expect(compared).toBeGreaterThan(50)
      expect(nodes).toBeGreaterThan(10)
    })
  }

  it('the body actually moves under the rule (the comparison is not of a resting body)', async () => {
    const ms = await loadMathspace()
    const engine = new MsEngine(ms, 42n)
    const bridge = new MsBridge()
    try {
      MsBridge.bootstrap(engine)
      const apply = (bytes: Uint8Array, tick: number): void => {
        const tr = bridge.translate(bytes, tick)
        expect(tr.code).toBe(0)
        for (const a of tr.actions) expect(engine.apply(a)).toBe(0)
      }
      apply(encodeDefineBrush({ ...INK_BRUSH, mass: 64 }, 1), 0)
      engine.step()
      const id = strokeIdOf(0, 1)
      const frame = [0, 0, 0, 65536, 0, 0, 0, 65536, 0]
      apply(encodeStrokeBegin(id, 1, 1, 1, frame), 1)
      const sample = { u: 0, v: 0, pressure: 65535, tiltX: 0, tiltY: 0, twist: 0, flags: 4 }
      apply(encodeStrokeSamples(id, [{ ...sample, tick: 1, index: 0 }]), 1)
      engine.step()
      apply(encodeStrokeSamples(id, [{ ...sample, u: 100 << 16, tick: 2, index: 0 }]), 2)
      for (let t = 2; t < 40; t++) engine.step()
      const body = engine.notes().get(bodyNoteId(id))!
      const x = body.get('pos')![0]!
      expect(x).toBeGreaterThan(0n)
      expect(x).not.toBe(fxFromQ16(100 << 16))
      expect(body.get('k')![0]).toBe(FX_ONE / 64n)
      apply(encodeStrokeEnd(id, 40), 40)
      expect(engine.notes().has(bodyNoteId(id))).toBe(false)
      expect(engine.notes().has(BODY_RULE_ID)).toBe(true)
      expect(engine.notes().has(BODY_SPACE_ID)).toBe(true)
    } finally {
      engine.destroy()
    }
  })
})

describe('ms-bridge: rejections answer the recorded ddsim codes', () => {
  const frame = [0, 0, 0, 65536, 0, 0, 0, 65536, 0]
  const sample = { u: 0, v: 0, pressure: 0, tiltX: 0, tiltY: 0, twist: 0, flags: 0 }

  /** (bytes, tick) pairs and the code ddsim answered (recorded before 7f), after ink at tick 0 and stroke 1 at tick 1. */
  const cases: Array<{ name: string; bytes: Uint8Array; tick: number; expected: number }> = [
    { name: 'DefineBrush with a skipped id', bytes: encodeDefineBrush(INK_BRUSH, 3), tick: 0, expected: BridgeError.BrushId },
    { name: 'DefineBrush with mass below 1 (k_t > 1)', bytes: encodeDefineBrush({ ...INK_BRUSH, mass: 0.5 }, 2), tick: 0, expected: BridgeError.BrushInvalid },
    { name: 'DefineBrush with zero spacing', bytes: encodeDefineBrush({ ...INK_BRUSH, spacing: 0 }, 2), tick: 0, expected: BridgeError.BrushInvalid },
    { name: 'StrokeBegin at the wrong tick', bytes: encodeStrokeBegin(strokeIdOf(0, 2), 1, 5, 0, frame), tick: 1, expected: BridgeError.TickMismatch },
    { name: 'StrokeBegin with an unknown brush', bytes: encodeStrokeBegin(strokeIdOf(0, 2), 7, 1, 0, frame), tick: 1, expected: BridgeError.BrushId },
    { name: 'StrokeBegin of an active stroke', bytes: encodeStrokeBegin(strokeIdOf(0, 1), 1, 1, 0, frame), tick: 1, expected: BridgeError.StrokeState },
    { name: 'StrokeSamples for an unknown stroke', bytes: encodeStrokeSamples(strokeIdOf(0, 9), [{ ...sample, tick: 1, index: 0 }]), tick: 1, expected: BridgeError.StrokeState },
    { name: 'StrokeSamples out of order', bytes: encodeStrokeSamples(strokeIdOf(0, 1), [{ ...sample, tick: 1, index: 1 }]), tick: 1, expected: BridgeError.SampleOrder },
    { name: 'StrokeSamples with a stale tick', bytes: encodeStrokeSamples(strokeIdOf(0, 1), [{ ...sample, tick: 0, index: 0 }]), tick: 1, expected: BridgeError.TickMismatch },
    { name: 'StrokeSamples with a bad flag bit', bytes: encodeStrokeSamples(strokeIdOf(0, 1), [{ ...sample, flags: 8, tick: 1, index: 0 }]), tick: 1, expected: BridgeError.SampleRange },
    { name: 'StrokeEnd at the wrong tick', bytes: encodeStrokeEnd(strokeIdOf(0, 1), 3), tick: 1, expected: BridgeError.TickMismatch },
    { name: 'StrokeEnd of an unknown stroke', bytes: encodeStrokeEnd(strokeIdOf(0, 4), 1), tick: 1, expected: BridgeError.StrokeState },
    { name: 'a truncated StrokeBegin', bytes: encodeStrokeBegin(strokeIdOf(0, 2), 1, 1, 0, frame).slice(0, 40), tick: 1, expected: BridgeError.BadLength },
    { name: 'an unknown kind', bytes: Uint8Array.from([9, 1, 0, 0, 0, 0, 0, 0]), tick: 1, expected: BridgeError.UnknownKind },
    { name: 'a bad header version', bytes: Uint8Array.from([1, 2, 0, 0, 0, 0, 0, 0]), tick: 1, expected: BridgeError.BadHeader },
  ]

  for (const c of cases) {
    it(`${c.name}: the bridge answers ${c.expected} and is unchanged`, () => {
      const bridge = new MsBridge()
      const setup: Array<[Uint8Array, number]> = [
        [encodeDefineBrush(INK_BRUSH, 1), 0],
        [encodeStrokeBegin(strokeIdOf(0, 1), 1, 1, 0, frame), 1],
      ]
      for (const [bytes, tick] of setup) {
        expect(bridge.translate(bytes, tick).code).toBe(0)
      }
      const before = JSON.stringify({ brushes: bridge.brushes, strokes: [...bridge.strokes.values()] }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
      const tr = bridge.translate(c.bytes, c.tick)
      expect(tr.code).toBe(c.expected)
      expect(tr.actions).toEqual([])
      const after = JSON.stringify({ brushes: bridge.brushes, strokes: [...bridge.strokes.values()] }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
      expect(after).toBe(before)
    })
  }
})

describe('ms-bridge: ids', () => {
  it('bodyNoteId is make_node_id(branch, ordinal, 2^24 - 1) and never a small id', () => {
    expect(makeNodeId(0, 1, 0)).toBe(1n << 24n)
    expect(makeNodeId(2, 3, 4)).toBe((2n << 56n) | (3n << 24n) | 4n)
    expect(bodyNoteId(strokeIdOf(0, 1))).toBe((1n << 24n) | BigInt(BODY_INDEX))
    expect(bodyNoteId(strokeIdOf(5, 7))).toBe((5n << 56n) | (7n << 24n) | BigInt(BODY_INDEX))
    expect(bodyNoteId(strokeIdOf(0, 1))).toBeGreaterThan(BODY_RULE_ID)
  })

  it('decodeSnapshot round-trips the field layout the engine writes', async () => {
    const ms = await loadMathspace()
    const engine = new MsEngine(ms, 3n)
    try {
      MsBridge.bootstrap(engine)
      const snap = decodeSnapshot(engine.notesBytes())
      expect([...snap.keys()]).toEqual([BODY_SPACE_ID, BODY_RULE_ID, NODE_SPACE_ID])
      expect(snap.get(BODY_RULE_ID)!.get('scope')).toEqual([0n])
    } finally {
      engine.destroy()
    }
  })
})
