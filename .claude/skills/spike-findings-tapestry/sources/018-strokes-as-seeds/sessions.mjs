// Synthetic pen sessions as data-drawing action lists, standing in for real
// painted sessions until Kaelen draws some (the page records real ones).
// A pen reports ~120 samples/s; pressure rises, holds and tapers; the hand
// wobbles a little (a hash, so a session is the same every time); every
// value is quantized once to data-drawing's integers (Q16.16 u/v, u16
// pressure), as its input fence does.

const Q = 65536
const IDENTITY = Array.from({ length: 17 }, (_, i) => (i === 16 ? 65535 : i * 4096))
// data-drawing's four presets (sim/include/ddsim/presets.hpp)
export const BRUSHES = [
  { kind: 'DefineBrush', brushVersionId: 1, description: 'ink', massRaw: 4294967296, radiusRaw: 3221225472, spacingRaw: 2147483648, curve: IDENTITY },
  { kind: 'DefineBrush', brushVersionId: 2, description: 'rust', massRaw: 17179869184, radiusRaw: 3865470566, spacingRaw: 1932735283, curve: IDENTITY },
  { kind: 'DefineBrush', brushVersionId: 3, description: 'clay', massRaw: 68719476736, radiusRaw: 4724464025, spacingRaw: 1717986918, curve: IDENTITY },
  { kind: 'DefineBrush', brushVersionId: 4, description: 'lead', massRaw: 274877906944, radiusRaw: 5583457485, spacingRaw: 1503238553, curve: IDENTITY },
]
const BRUSH = { ink: 1, rust: 2, clay: 3, lead: 4 }
export const PLANES = {
  front: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  side: [0, 0, 0, 0, 0, 1, 0, 1, 0],
  top: [0, 0, 0, 1, 0, 0, 0, 0, 1],
}

function wobble(seed, i) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12
  return ((h >>> 0) / 4294967296 - 0.5) * 0.02
}

// A stroke along curve(t) for t in [0, 1] (plane u, v in world units).
export function stroke(id, brush, plane, curve, { seconds = 0.8, startTick = id * 60, peak = 0.8 } = {}) {
  const n = Math.max(4, Math.round(seconds * 120))
  const samples = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const [u, v] = curve(t)
    const ramp = Math.min(1, t * 6) * Math.min(1, (1 - t) * 3 + 0.15)
    samples.push({
      tick: startTick + Math.floor(i / 2), index: i, pressure: Math.round(Math.min(1, peak * ramp) * 65535),
      u: Math.round((u + wobble(id, 2 * i)) * Q), v: Math.round((v + wobble(id, 2 * i + 1)) * Q),
      tiltX: 0, tiltY: 0, twist: 0, flags: 0,
    })
  }
  return [
    { kind: 'StrokeBegin', strokeId: id, brushVersionId: BRUSH[brush], startTick, pressureSource: 1, plane: PLANES[plane].map((x) => Math.round(x * Q)) },
    { kind: 'StrokeSamples', strokeId: id, samples },
    { kind: 'StrokeEnd', strokeId: id, endTick: startTick + Math.floor(n / 2) },
  ]
}

const lerp = (a, b, t) => a + (b - a) * t
const bezier = (p0, p1, p2) => (t) => [lerp(lerp(p0[0], p1[0], t), lerp(p1[0], p2[0], t), t), lerp(lerp(p0[1], p1[1], t), lerp(p1[1], p2[1], t), t)]

export const SESSIONS = {
  // Drawn on one plane: a trunk, two limbs, a ground line, a cloud of mass
  // above, and a rust stroke joining the limb tips.
  sapling: () => [
    ...BRUSHES,
    ...stroke(1, 'ink', 'front', bezier([0, 0], [0.35, 1.6], [0.15, 3.3]), { peak: 1 }),
    ...stroke(2, 'ink', 'front', bezier([0.1, 1.7], [-0.9, 2.2], [-1.9, 3.3])),
    ...stroke(3, 'ink', 'front', bezier([0.2, 2.2], [1.1, 2.6], [1.7, 3.7]), { peak: 0.7 }),
    ...stroke(4, 'lead', 'front', bezier([-2.6, 0], [0, 0.05], [2.6, 0]), { seconds: 0.6 }),
    ...stroke(5, 'clay', 'front', (t) => [Math.cos(t * 12.6) * (0.6 + t * 0.8), 5.6 + Math.sin(t * 12.6) * (0.4 + t * 0.4)], { seconds: 1.2, peak: 0.9 }),
    ...stroke(6, 'rust', 'front', bezier([-1.85, 3.3], [0, 4.4], [1.65, 3.7]), { peak: 0.6 }),
  ],
  // Drawn on three planes: stems radiate in 3D and rust strokes weave them.
  lantern: () => [
    ...BRUSHES,
    ...stroke(1, 'ink', 'front', bezier([0, 0], [-1.2, 1.2], [-1.6, 3.0]), { peak: 0.9 }),
    ...stroke(2, 'ink', 'front', bezier([0, 0], [1.2, 1.2], [1.6, 3.0]), { peak: 0.9 }),
    ...stroke(3, 'ink', 'side', bezier([0, 0], [1.2, 1.3], [1.5, 3.1]), { peak: 0.9 }),
    ...stroke(4, 'ink', 'side', bezier([0, 0], [-1.2, 1.3], [-1.5, 3.1]), { peak: 0.9 }),
    ...stroke(5, 'lead', 'top', (t) => [Math.cos(t * 6.2832) * 2.2, Math.sin(t * 6.2832) * 2.2], { seconds: 1.4 }),
    ...stroke(6, 'rust', 'front', bezier([-1.6, 3.0], [0, 3.9], [1.6, 3.0])),
    ...stroke(7, 'rust', 'side', bezier([-1.5, 3.1], [0, 3.9], [1.5, 3.1])),
  ],
}
