/**
 * The bridge (kinds 1..4 into mathspace actions) against ddsim itself: the
 * committed .actions fixtures replayed through both Wasm modules in
 * lockstep must give the same brush body, raw bit for raw bit, on every
 * tick where the stroke has a target, and the same node table (every
 * emitted node's id and raw fields) after every tick. Both modules come
 * from surface/wasm/ (`npm run sim:wasm`); a mock would prove nothing here.
 *
 * Only the one-sample-per-tick fixtures are compared: the bridge keeps one
 * engine step per tick (STATE.md Decisions), so `four-per-tick` diverges
 * by design and is re-recorded in 7e.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import createDdsim from '../wasm/ddsim.mjs'
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
  type DdsimModule,
} from '../src/ddsim-abi'
import { MsEngine, decodeSnapshot, fxFromInt, fxFromQ16, FX_ONE, type MathspaceModule } from '../src/ms-abi'
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

let ddsimPromise: Promise<DdsimModule> | null = null
let mathspacePromise: Promise<MathspaceModule> | null = null
function loadDdsim(): Promise<DdsimModule> {
  const p = ddsimPromise ?? createDdsim()
  ddsimPromise = p
  return p
}
function loadMathspace(): Promise<MathspaceModule> {
  const p = mathspacePromise ?? createMathspace()
  mathspacePromise = p
  return p
}

function ddApply(mod: DdsimModule, sim: number, bytes: Uint8Array): number {
  const ptr = mod._malloc(bytes.length)
  try {
    mod.HEAPU8.set(bytes, ptr)
    return mod._dd_apply(sim, ptr, bytes.length)
  } finally {
    mod._free(ptr)
  }
}

interface RawBody { x: bigint; y: bigint; vx: bigint; vy: bigint; tu: bigint; tv: bigint }

/** The ddsim body table by stroke id, raw Q32.32 (no float conversion: this is a bit comparison). */
function ddBodies(mod: DdsimModule, sim: number): Map<bigint, RawBody> {
  const count = mod._dd_body_count(sim)
  const ptr = mod._dd_body_ptr(sim)
  const bytes = mod.HEAPU8.slice(ptr, ptr + count * BODY_STRIDE)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Map<bigint, RawBody>()
  for (let i = 0; i < count; i++) {
    const at = i * BODY_STRIDE
    out.set(dv.getBigUint64(at, true), {
      x: dv.getBigInt64(at + 8, true),
      y: dv.getBigInt64(at + 16, true),
      vx: dv.getBigInt64(at + 24, true),
      vy: dv.getBigInt64(at + 32, true),
      tu: dv.getBigInt64(at + 40, true),
      tv: dv.getBigInt64(at + 48, true),
    })
  }
  return out
}

interface RawNode {
  x: bigint; y: bigint; z: bigint; weight: bigint; dirX: bigint; dirY: bigint; vx: bigint; vy: bigint
  tick: number; brush: number; scaleBand: number
}

/** The ddsim node table by id, raw Q32.32 (stride 88, the decodeNodes layout). */
function ddNodes(mod: DdsimModule, sim: number): Map<bigint, RawNode> {
  const count = mod._dd_node_count(sim)
  const ptr = mod._dd_nodes_ptr(sim)
  const bytes = mod.HEAPU8.slice(ptr, ptr + count * NODE_STRIDE)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Map<bigint, RawNode>()
  for (let i = 0; i < count; i++) {
    const at = i * NODE_STRIDE
    out.set(dv.getBigUint64(at, true), {
      x: dv.getBigInt64(at + 8, true),
      y: dv.getBigInt64(at + 16, true),
      z: dv.getBigInt64(at + 24, true),
      weight: dv.getBigInt64(at + 32, true),
      dirX: dv.getBigInt64(at + 40, true),
      dirY: dv.getBigInt64(at + 48, true),
      vx: dv.getBigInt64(at + 56, true),
      vy: dv.getBigInt64(at + 64, true),
      tick: dv.getUint32(at + 72, true),
      brush: dv.getUint32(at + 76, true),
      scaleBand: dv.getUint32(at + 80, true),
    })
  }
  return out
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
 * Every ddsim node has a mathspace note with the same raw fields, and there
 * are no others. Ids are compared every tick; fields once, on the tick a
 * node appears (neither sim ever changes an emitted node), so a fixture of
 * a few hundred nodes over a thousand ticks does not spend its time here.
 */
function expectSameNodes(t: number, dd: Map<bigint, RawNode>, ms: Map<bigint, Map<string, bigint[]>>, seen: Set<bigint>): void {
  expect([...ms.keys()].sort(), `tick ${t}: node ids`).toEqual([...dd.keys()].sort())
  for (const [id, n] of dd) {
    if (seen.has(id)) continue
    seen.add(id)
    const note = ms.get(id)!
    expect(note.get('pos'), `tick ${t} node ${id}: pos`).toEqual([n.x, n.y, n.z])
    expect(note.get('weight'), `tick ${t} node ${id}: weight`).toEqual([n.weight])
    expect(note.get('dir'), `tick ${t} node ${id}: dir`).toEqual([n.dirX, n.dirY])
    expect(note.get('velocity'), `tick ${t} node ${id}: velocity`).toEqual([n.vx, n.vy])
    expect(note.get('tick'), `tick ${t} node ${id}: tick`).toEqual([fxFromInt(n.tick)])
    expect(note.get('brush'), `tick ${t} node ${id}: brush`).toEqual([fxFromInt(n.brush)])
    expect(n.scaleBand, `tick ${t} node ${id}: scale band`).toBe(0)
  }
}

/**
 * Replays `fixture` through ddsim and, via the bridge, through mathspace.
 * Returns the number of (tick, stroke) body comparisons made and the node
 * count at the end, and throws on the first mismatch with the tick and
 * field in the message.
 */
function replayInLockstep(dd: DdsimModule, ms: MathspaceModule, fixture: Fixture): { compared: number; nodes: number } {
  const sim = dd._dd_create(fixture.seed)
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
        const rc = ddApply(dd, sim, a.bytes)
        const tr = bridge.translate(a.bytes, t)
        expect(tr.code, `tick ${t}: bridge code vs ddsim code`).toBe(rc)
        expect(rc, `tick ${t}: ddsim rejected a fixture action`).toBe(0)
        for (const act of tr.actions) {
          expect(engine.apply(act), `tick ${t}: mathspace rejected a bridge action`).toBe(0)
        }
      }
      dd._dd_step(sim)
      engine.step()
      expect(engine.errors(), `tick ${t}: the rule skipped something`).toEqual([])
      for (const act of bridge.afterStep(engine.notes(), t)) {
        expect(engine.apply(act), `tick ${t}: mathspace rejected an emission action`).toBe(0)
      }
      const bodies = ddBodies(dd, sim)
      const notes = engine.notes()
      const table = ddNodes(dd, sim)
      expectSameNodes(t, table, msNodes(notes), seen)
      expect(bridge.nodeCount, `tick ${t}: bridge node count`).toBe(table.size)
      nodes = table.size
      for (const st of bridge.strokes.values()) {
        const body = bodies.get(st.id)
        expect(body, `tick ${t}: ddsim has no body for stroke ${st.id}`).toBeDefined()
        const note = notes.get(bodyNoteId(st.id))
        expect(note, `tick ${t}: mathspace has no body note for stroke ${st.id}`).toBeDefined()
        if (!st.hasTarget) continue
        const pos = note!.get('pos')!
        const vel = note!.get('velocity')!
        const target = note!.get('target')!
        expect(pos[0], `tick ${t} stroke ${st.id}: x`).toBe(body!.x)
        expect(pos[1], `tick ${t} stroke ${st.id}: y`).toBe(body!.y)
        expect(vel[0], `tick ${t} stroke ${st.id}: vx`).toBe(body!.vx)
        expect(vel[1], `tick ${t} stroke ${st.id}: vy`).toBe(body!.vy)
        expect(target[0], `tick ${t} stroke ${st.id}: target u`).toBe(body!.tu)
        expect(target[1], `tick ${t} stroke ${st.id}: target v`).toBe(body!.tv)
        compared++
      }
      // A stroke ddsim still lists is one the bridge still lists, and vice versa.
      expect([...bodies.keys()].sort(), `tick ${t}: active strokes`).toEqual([...bridge.strokes.keys()].sort())
    }
  } finally {
    engine.destroy()
    dd._dd_destroy(sim)
  }
  return { compared, nodes }
}

describe('ms-bridge: body and node parity with ddsim', () => {
  for (const name of ONE_SAMPLE_FIXTURES) {
    it(`${name}: the mathspace body and node table equal ddsim's raw bits on every tick`, async () => {
      const [dd, ms] = await Promise.all([loadDdsim(), loadMathspace()])
      const fixture = parseActions(readFileSync(join(GOLDEN_DIR, `${name}.actions`), 'utf8'))
      const { compared, nodes } = replayInLockstep(dd, ms, fixture)
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

describe('ms-bridge: rejection parity with ddsim', () => {
  const frame = [0, 0, 0, 65536, 0, 0, 0, 65536, 0]
  const sample = { u: 0, v: 0, pressure: 0, tiltX: 0, tiltY: 0, twist: 0, flags: 0 }

  /** (bytes, tick) pairs whose codes the bridge must match ddsim on, after ink at tick 0 and stroke 1 at tick 1. */
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
    it(`${c.name}: bridge and ddsim both answer ${c.expected}, and the bridge is unchanged`, async () => {
      const dd = await loadDdsim()
      const sim = dd._dd_create(1n)
      const bridge = new MsBridge()
      try {
        const setup: Array<[Uint8Array, number]> = [
          [encodeDefineBrush(INK_BRUSH, 1), 0],
          [encodeStrokeBegin(strokeIdOf(0, 1), 1, 1, 0, frame), 1],
        ]
        for (const [bytes, tick] of setup) {
          while (Number(dd._dd_tick(sim)) < tick) dd._dd_step(sim)
          expect(ddApply(dd, sim, bytes)).toBe(0)
          expect(bridge.translate(bytes, tick).code).toBe(0)
        }
        while (Number(dd._dd_tick(sim)) < c.tick) dd._dd_step(sim)
        const before = JSON.stringify({ brushes: bridge.brushes, strokes: [...bridge.strokes.values()] }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
        const tr = bridge.translate(c.bytes, c.tick)
        expect(tr.code).toBe(c.expected)
        expect(ddApply(dd, sim, c.bytes)).toBe(c.expected)
        expect(tr.actions).toEqual([])
        const after = JSON.stringify({ brushes: bridge.brushes, strokes: [...bridge.strokes.values()] }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
        expect(after).toBe(before)
      } finally {
        dd._dd_destroy(sim)
      }
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
