// Seed descriptions: everything the object is, before expansion. Each one is
// 3–10 vectors, a few knots and some rule overrides.

export const PRESETS = {
  // A trunk and two limbs reaching for light above.
  tree: {
    seeds: [
      { id: 'trunk', start: [0, 0, 0], dir: [0, 1, 0], len: 3.2, radius: 0.28 },
      { id: 'limbL', start: [0, 1.9, 0], dir: [-0.8, 0.9, 0.2], len: 2.0, radius: 0.16 },
      { id: 'limbR', start: [0, 2.3, 0], dir: [0.7, 0.9, -0.3], len: 1.8, radius: 0.15 },
    ],
    knots: [
      { from: 'limbL', to: 'limbR', type: 'repel', w: 0.6 },
      { from: 'limbR', to: 'limbL', type: 'repel', w: 0.6 },
    ],
    attractors: [{ p: [0, 9, 0], w: 0.3 }],
    rules: { branching: [3, 3, 3, 3, 2, 2], spread: 0.95, tropism: [0, 0.1, 0] },
  },

  // Five stalks from one base; strong repulsion fans them into a sheet.
  coral: {
    seeds: [-2, -1, 0, 1, 2].map((i) => ({
      id: `stalk${i + 2}`, start: [i * 0.15, 0, 0], dir: [i * 0.35, 1, i * 0.05], len: 1.6, radius: 0.1,
    })),
    knots: [],
    rules: { branching: [2, 3, 3, 3, 2, 2], spread: 0.7, repel: 1.6, align: 0.05, tropism: [0, 0.18, 0], lenRatio: 0.72, curvature: 0.5 },
  },

  // Two stalks with nothing but a knot between them: attraction makes them
  // grow toward each other and meet in an arch. The relationship is what
  // makes the structure. The base is an anchor: it repels growth, never grows.
  bridge: {
    seeds: [
      { id: 'west', start: [-3, 0, 0], dir: [0.15, 1, 0], len: 2.2, radius: 0.18 },
      { id: 'east', start: [3, 0, 0], dir: [-0.15, 1, 0], len: 2.2, radius: 0.18 },
      { id: 'base', start: [-3, 0, 0], dir: [1, 0, 0], len: 6, radius: 0.06, grow: false },
    ],
    knots: [
      { from: 'west', to: 'east', type: 'attract', w: 1.6 },
      { from: 'east', to: 'west', type: 'attract', w: 1.6 },
    ],
    rules: { branching: [3, 3, 3, 2, 2, 2], spread: 0.6, tropism: [0, 0.05, 0], lenRatio: 0.68 },
  },
}
