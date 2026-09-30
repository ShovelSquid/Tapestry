// Ground-truth 3D stems for spikes 019 and 020: s ∈ [0,1] → [x, y, z], root to tip.

const TAU = 6.283185307179586
// Each curve is s ∈ [0,1] → [x, y, z], drawn root to tip.
export const CURVES = {
  lean: (s) => [0.9 * s * s, 3.2 * s, -0.6 * s],
  helix: (s) => [0.6 * Math.cos(TAU * 1.2 * s) - 0.6, 3.2 * s, 0.6 * Math.sin(TAU * 1.2 * s)],
  hook: (s) => [1.6 * s * s, 3.4 * Math.sin(Math.PI * 0.75 * s) / Math.sin(Math.PI * 0.75 * 0.667), 0.8 * s],
  flatRun: (s) => (s < 0.5 ? [0, 4 * s, 0.3 * s] : [2.4 * (s - 0.5), 2, 0.15 + 0.2 * (s - 0.5)]),
  // drawn at different paces in the two views (side view races the start)
  uneven: (s) => [0.7 * Math.sin(Math.PI * s), 3 * s, 0.5 * s * s],
}
