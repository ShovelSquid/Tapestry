/**
 * image.js is the whole kernel↔engine boundary, so its tests pin three
 * things: number conversion is exact and refuses what it cannot represent,
 * the JS action encoders produce the same bytes as the C++ ones (the
 * velocity golden), and the checkpoint fixture's kernel nodes run through
 * the real engine to exactly the expected set ops.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { Engine, hexOf, loadModule } from './engine-cjs.js'
import {
  ERROR_KEY, IMPLICIT_SPACE_ID, RULE_TYPE, SPACE_TYPE, VIEW_TYPE, buildImage, diff, encodeCreateNote, encodeCreateSpace, encodeSetField,
  engineSource, laneKey, nodeIdToU64, parseKey, parseSnapshot, rawToReal, realToRaw, u64ToNodeId,
} from './image-cjs.js'
import { parseActions } from './fixture-replay.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const GOLDEN_DIR = join(HERE, '..', '..', '..', 'tests', 'golden', 'ms')
const ONE = 4294967296n

describe('real ↔ raw', () => {
  it('converts exactly representable reals', () => {
    expect(realToRaw(0)).toBe(0n)
    expect(realToRaw(1)).toBe(ONE)
    expect(realToRaw(-12.5)).toBe(-12n * ONE - ONE / 2n)
    expect(realToRaw(2 ** -32)).toBe(1n)
    expect(realToRaw(2 ** 21 - 2 ** -32)).toBe(2n ** 53n - 1n)
  })
  it('rejects reals that are not k / 2^32 with |k| < 2^53', () => {
    expect(() => realToRaw(0.1)).toThrow(RangeError)
    expect(() => realToRaw(1 / 3)).toThrow(RangeError)
    expect(() => realToRaw(2 ** 21)).toThrow(RangeError)
    expect(() => realToRaw(-(2 ** 21))).toThrow(RangeError)
    expect(() => realToRaw(NaN)).toThrow(RangeError)
    expect(() => realToRaw(Infinity)).toThrow(RangeError)
    expect(() => realToRaw('1')).toThrow(RangeError)
  })
  it('round-trips', () => {
    for (const r of [0, 1, -1, 12.5, 0.25, -0.75, 1234567.0000152587890625, 2 ** 21 - 2 ** -32]) {
      expect(rawToReal(realToRaw(r))).toBe(r)
    }
    expect(rawToReal(-1n)).toBe(-(2 ** -32))
    expect(() => rawToReal(2n ** 53n)).toThrow(RangeError)
    expect(() => rawToReal(5)).toThrow(RangeError)
  })
})

describe('ids and keys', () => {
  it('maps n<k> both ways and rejects anything else', () => {
    expect(nodeIdToU64('n1')).toBe(1n)
    expect(nodeIdToU64('n18446744073709551615')).toBe(2n ** 64n - 1n)
    expect(u64ToNodeId(42n)).toBe('n42')
    for (const bad of ['n0', 'n01', 'e3', '3', 'n', 'n-1', 'n1.5']) expect(() => nodeIdToU64(bad)).toThrow()
  })
  it('parses lane keys per the convention, renaming position to pos', () => {
    expect(parseKey('position.x')).toEqual({ field: 'pos', lane: 0 })
    expect(parseKey('velocity.w')).toEqual({ field: 'velocity', lane: 3 })
    expect(parseKey('mass')).toEqual({ field: 'mass', lane: 0 })
    expect(parseKey('q.7')).toEqual({ field: 'q', lane: 7 })
    expect(parseKey('q.8')).toBeNull()
    expect(parseKey('f.expr')).toBeNull()
    expect(parseKey('a.b.c')).toBeNull()
    expect(parseKey('.x')).toBeNull()
    expect(parseKey('x'.repeat(32))).toBeNull()
    expect(parseKey('x'.repeat(31))).toEqual({ field: 'x'.repeat(31), lane: 0 })
  })
  it('formats lane keys by dim', () => {
    expect(laneKey('mass', 0, 1)).toBe('mass')
    expect(laneKey('pos', 1, 2)).toBe('position.y')
    expect(laneKey('q', 3, 4)).toBe('q.w')
    expect(laneKey('q', 3, 5)).toBe('q.3')
  })
})

describe('action encoders match the C++ bytes of velocity.actions', () => {
  const fixture = parseActions(readFileSync(join(GOLDEN_DIR, 'velocity.actions'), 'utf8'))
  const golden = fixture.actions.map((a) => hexOf(a.bytes))
  it('CreateSpace', () => expect(hexOf(encodeCreateSpace(1n, 2))).toBe(golden[0]))
  it('CreateNote', () => expect(hexOf(encodeCreateNote(2n, 1n, 1))).toBe(golden[1]))
  it('SetField pos', () => expect(hexOf(encodeSetField(2n, { name: 'pos', dim: 2, lanes: [0n, 0n] }))).toBe(golden[2]))
  it('SetField velocity', () => expect(hexOf(encodeSetField(2n, { name: 'velocity', dim: 2, lanes: [ONE, 2n * ONE] }))).toBe(golden[3]))
})

const real = (value) => ({ type: 'real', value })
const int = (value) => ({ type: 'int', value })

describe('buildImage', () => {
  it('puts positioned notes in the implicit space, fields in name order, and ignores the rest', () => {
    const img = buildImage([
      { id: 'n5', type: 'tapestry.notes/note@1', props: { 'position.x': real(1), 'position.y': real(2), 'velocity.y': real(3), 'title': { type: 'text', value: 't' }, 'f.expr': { type: 'text', value: 'x' } } },
      { id: 'n4', type: 'tapestry.notes/note@1', props: { 'position.x': real(0), 'position.y': real(0), 'mass': int(3) } },
      { id: 'n6', type: 'tapestry.notes/note@1', props: { 'title': { type: 'text', value: 'no position' } } },
    ])
    expect(img.problems).toEqual([])
    expect([...img.fields.keys()]).toEqual([4n, 5n])
    expect([...img.fields.get(5n).keys()]).toEqual(['pos', 'velocity'])
    expect(img.fields.get(5n).get('velocity')).toEqual([0n, 3n * ONE])
    expect(img.fields.get(4n).get('mass')).toEqual([3n * ONE])
    expect(img.types.get('n4|mass')).toBe('int')
    expect(hexOf(img.actions[0])).toBe(hexOf(encodeCreateSpace(IMPLICIT_SPACE_ID, 2)))
    expect(hexOf(img.actions[1])).toBe(hexOf(encodeCreateNote(4n, IMPLICIT_SPACE_ID, 1)))
    expect(img.actions).toHaveLength(1 + 3 + 3)
  })
  it('pads a lane-addressed field to the space dim and leaves scalars alone', () => {
    const img = buildImage([
      { id: 'n1', type: 'tapestry.notes/note@1', props: { 'position.x': real(0), 'position.y': real(0), 'velocity.x': real(1), mass: real(2) } },
      { id: 'n2', type: 'tapestry.notes/note@1', props: { space: { type: 'ref', value: 'n3' }, 'q.2': real(1) } },
      { id: 'n3', type: SPACE_TYPE, props: { dim: int(5) } },
    ])
    expect(img.problems).toEqual([])
    expect(img.fields.get(1n).get('velocity')).toEqual([ONE, 0n])
    expect(img.fields.get(1n).get('mass')).toEqual([2n * ONE])
    expect(img.fields.get(2n).get('q')).toEqual([0n, 0n, ONE, 0n, 0n])
  })
  it('records an inexact real as a problem and drops that whole field', () => {
    const img = buildImage([
      { id: 'n1', type: 'tapestry.notes/note@1', props: { 'position.x': real(0.1), 'position.y': real(2), 'velocity.x': real(1) } },
    ])
    expect(img.problems).toHaveLength(1)
    expect(img.problems[0]).toMatchObject({ id: 'n1', key: 'position.x' })
    expect([...img.fields.get(1n).keys()]).toEqual(['velocity'])
  })
  it('uses explicit spaces and checks position dim against them', () => {
    const img = buildImage([
      { id: 'n9', type: 'tapestry.notes/note@1', props: { space: { type: 'ref', value: 'n7' }, 'position.x': real(1), 'position.y': real(1), 'position.z': real(1) } },
      { id: 'n7', type: SPACE_TYPE, props: { dim: int(3) } },
      { id: 'n8', type: 'tapestry.notes/note@1', props: { space: { type: 'ref', value: 'n7' }, 'position.x': real(1), 'position.y': real(1) } },
      { id: 'n10', type: 'tapestry.notes/note@1', props: { space: { type: 'ref', value: 'n99' }, 'position.x': real(1), 'position.y': real(1) } },
      { id: 'n11', type: 'tapestry.notes/note@1', props: { 'position.x': real(1), 'position.y': real(1), 'position.z': real(1) } },
    ])
    // n10 names a space that is not one; n11 has three lanes in the implicit 2-space.
    expect(img.problems.map((p) => p.id).sort()).toEqual(['n10', 'n11'])
    expect(hexOf(img.actions[0])).toBe(hexOf(encodeCreateSpace(7n, 3)))
    expect([...img.fields.keys()]).toEqual([8n, 9n, 11n])
    expect(img.fields.get(8n).get('pos')).toEqual([ONE, ONE, 0n]) // padded to the 3-space
    expect(img.fields.get(9n).get('pos')).toEqual([ONE, ONE, ONE])
    expect(img.fields.get(11n).has('pos')).toBe(false)
  })
  it('rule nodes: NoteKind::Rule, scope text to a scalar, set.<f>.expr allowed, existing error text recorded', () => {
    const img = buildImage([
      { id: 'n2', type: 'tapestry.notes/note@1', props: { 'position.x': real(0), 'position.y': real(0), 'set.k.expr': { type: 'text', value: '1' } } },
      { id: 'n3', type: RULE_TYPE, props: { 'position.x': real(5), 'position.y': real(5), scope: { type: 'text', value: 'pair' }, 'force.expr': { type: 'text', value: '[1, 0]' }, 'set.k.expr': { type: 'text', value: '1' }, 'set.a.b.expr': { type: 'text', value: '1' } } },
      { id: 'n4', type: RULE_TYPE, props: { 'position.x': real(0), 'position.y': real(0), scope: { type: 'text', value: 'pari' }, 'force.expr': { type: 'text', value: '[1, 0]' }, [ERROR_KEY]: { type: 'text', value: 'old' } } },
      { id: 'n5', type: RULE_TYPE, props: { 'position.x': real(0), 'position.y': real(0) } },
    ])
    // n2 is a plain note, so its dotted set.k is a bad key; n3's set.a.b is too; n4's scope is not a scope.
    expect(img.problems).toEqual([
      { id: 'n2', key: 'set.k.expr', reason: '"set.k" is not a field name' },
      { id: 'n3', key: 'set.a.b.expr', reason: '"set.a.b" is not a field name' },
      { id: 'n4', key: 'scope', reason: 'scope must be one of unary, pair, global' },
    ])
    expect([...img.fields.keys()]).toEqual([2n, 3n, 5n]) // n4 stays out of the image
    expect(img.fields.get(3n).get('scope')).toEqual([ONE])
    expect(img.fields.get(5n).has('scope')).toBe(false) // absent scope is unary in the engine
    expect(hexOf(img.actions[3])).toBe(hexOf(encodeCreateNote(3n, IMPLICIT_SPACE_ID, 2)))
    expect(img.bindings.map((b) => `${b.node} ${b.name}`)).toEqual(['n3 force', 'n3 set.k'])
    expect(img.rules).toEqual(new Map([['n3', null], ['n4', 'old'], ['n5', null]]))
  })
  it('view nodes: NoteKind::View, project.expr bound like a law, error text recorded, set. not allowed', () => {
    const img = buildImage([
      { id: 'n1', type: SPACE_TYPE, props: { dim: { type: 'int', value: 3 } } },
      { id: 'n2', type: 'tapestry.notes/note@1', props: { space: { type: 'ref', value: 'n1' }, 'position.x': real(1) } },
      { id: 'n3', type: VIEW_TYPE, props: { space: { type: 'ref', value: 'n1' }, 'project.expr': { type: 'text', value: '[self.position.x, self.position.y]' }, [ERROR_KEY]: { type: 'text', value: 'old' } } },
      { id: 'n4', type: VIEW_TYPE, props: { 'position.x': real(0), 'position.y': real(0), 'set.k.expr': { type: 'text', value: '1' } } },
    ])
    expect(img.problems).toEqual([{ id: 'n4', key: 'set.k.expr', reason: '"set.k" is not a field name' }])
    expect([...img.fields.keys()]).toEqual([2n, 3n, 4n])
    expect(hexOf(img.actions[4])).toBe(hexOf(encodeCreateNote(3n, 1n, 3)))
    expect(img.bindings.map((b) => `${b.node} ${b.name}`)).toEqual(['n3 project'])
    expect(img.rules).toEqual(new Map([['n3', 'old'], ['n4', null]]))
  })
  it('maps pinned bool true to the scalar pinned 1 and sends nothing for false', () => {
    const img = buildImage([
      { id: 'n1', type: 'tapestry.notes/note@1', props: { 'position.x': real(0), 'position.y': real(0), pinned: { type: 'bool', value: true } } },
      { id: 'n2', type: 'tapestry.notes/note@1', props: { 'position.x': real(0), 'position.y': real(0), pinned: { type: 'bool', value: false } } },
    ])
    expect(img.fields.get(1n).get('pinned')).toEqual([ONE])
    expect(img.fields.get(2n).has('pinned')).toBe(false)
  })
})

describe('parseSnapshot and diff', () => {
  it('parses the snapshot layout', () => {
    const bytes = new Uint8Array([
      2, 0, 0, 0, 0, 0, 0, 0, 1, // id 2, one field
      3, 0x70, 0x6f, 0x73, 2, // "pos" dim 2
      0, 0, 0, 0, 1, 0, 0, 0, // 1.0
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // -2^-32
    ])
    const snap = parseSnapshot(bytes)
    expect([...snap.keys()]).toEqual([2n])
    expect(snap.get(2n).get('pos')).toEqual([ONE, -1n])
    expect(() => parseSnapshot(bytes.subarray(0, 20))).toThrow()
  })
  it('emits one set per changed lane, skips notes not in the image, keeps ints int', () => {
    const before = new Map([[2n, new Map([['pos', [0n, 0n]], ['mass', [3n * ONE]]])]])
    const after = new Map([
      [IMPLICIT_SPACE_ID, new Map([['pos', [0n, 0n]]])],
      [2n, new Map([['pos', [0n, 5n * ONE]], ['mass', [4n * ONE]], ['heat', [ONE / 2n]]])],
    ])
    const types = new Map([['n2|mass', 'int']])
    expect(diff(before, after, types)).toEqual([
      { op: 'setProperty', target: 'n2', key: 'heat', type: 'real', value: 0.5 },
      { op: 'setProperty', target: 'n2', key: 'mass', type: 'int', value: 4 },
      { op: 'setProperty', target: 'n2', key: 'position.y', type: 'real', value: 5 },
    ])
    expect(diff(before, before)).toEqual([])
    expect(diff(before, after, types, new Set(['n2']))).toEqual([])
  })
})

describe('checkpoint fixture through the engine', () => {
  it('velocity.json: the image steps to exactly the expected ops', async () => {
    const fx = JSON.parse(readFileSync(join(HERE, 'fixtures', 'velocity.json'), 'utf8'))
    const mod = await loadModule()
    const img = buildImage(fx.nodes)
    expect(img.problems).toEqual([])
    const engine = new Engine(mod, 1n)
    try {
      for (const a of img.actions) expect(engine.apply(a)).toBe(0)
      expect(diff(img.fields, parseSnapshot(engine.notes()), img.types)).toEqual([])
      for (let i = 0; i < fx.ticks; i++) engine.step()
      expect(diff(img.fields, parseSnapshot(engine.notes()), img.types)).toEqual(fx.expected)
    } finally {
      engine.destroy()
    }
  })
})

describe('engineSource', () => {
  it('rewrites .position after a ref head and maps offsets back', () => {
    const { text, back } = engineSource('self.position.x + node(n3).position.y * other.position + positionless + x.position')
    expect(text).toBe('self.pos.x + node(n3).pos.y * other.pos + positionless + x.position')
    expect(back(0)).toBe(0)
    expect(back(7)).toBe(7) // inside the first `pos`
    expect(back(8)).toBe(13) // the `.` after it
    expect(back(9)).toBe(14) // the `x`
    expect(text.indexOf('*')).toBe(28)
    expect(back(28)).toBe(38)
    expect(back(text.indexOf('positionless'))).toBe('self.position.x + node(n3).position.y * other.position + '.length)
  })

  it('counts bytes, not code points, before a rewrite', () => {
    const { text, back } = engineSource('π + self.position')
    expect(text).toBe('π + self.pos')
    expect(back(Buffer.byteLength(text, 'utf8'))).toBe(Buffer.byteLength('π + self.position', 'utf8'))
  })
})
