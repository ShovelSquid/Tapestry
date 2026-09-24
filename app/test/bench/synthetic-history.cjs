// Synthetic thread history for the scripted bench/shots harness
// (CONVENTIONS.md "Synthetic history"): seeded `mulberry32(7)` sessions of
// 2-15 min separated by 1-20 min away; inside a session, typing bursts of
// 5-40s at 3-8 keys/s separated by 2-30s pauses. Loads are 1h and 8h
// continuous (the phase's reference load: 1.73M dots, 78k letters).
//
// CommonJS so both the Electron main process (`thread-bench.cjs`) and the
// browser-side bench page (bundled through Vite, which accepts a plain CJS
// module with `module.exports`) can use the identical generator -- the
// bench harness's own measured numbers are only meaningful if every run
// draws from the same seeded history.
'use strict'

function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Enough distinct English letters/punctuation/spaces to produce a realistic
// grapheme mix without needing multi-byte handling in the generator itself
// (grapheme segmentation happens downstream, in the real recorder/replay
// code the bench harness exercises -- this text is plain ASCII on purpose).
const SAMPLE_TEXT =
  'ok i need to start writing my notes here, and just make it easier to use. this is a knowledge base as much as obsidian is. threads run through time, one letter at a time. '

/**
 * @param {number} hours total thread duration
 * @param {boolean} [continuous] when true, one session spans the whole
 *   duration (the phase's "8h continuous" reference load); when false,
 *   sessions are separated by away-gaps (the "8h" load).
 * @returns {{ sessions: [number, number][], keys: [number, string][], end: number }}
 *   `sessions` are `[start, end]` in seconds since thread start; `keys` are
 *   `[atSeconds, grapheme]` pairs in chronological order.
 */
function generateHistory(hours, continuous) {
  const random = mulberry32(7)
  const end = hours * 3600
  const sessions = []
  const keys = []
  let t = 0
  let ci = 0
  while (t < end) {
    const sessionEnd = continuous ? end : Math.min(end, t + 120 + random() * 780) // 2-15 min
    sessions.push([t, sessionEnd])
    let k = t
    while (k < sessionEnd) {
      const burstEnd = Math.min(sessionEnd, k + 5 + random() * 35) // 5-40s burst
      while (k < burstEnd) {
        keys.push([k, SAMPLE_TEXT[ci++ % SAMPLE_TEXT.length]])
        k += 0.12 + random() * 0.2 // 3-8 keys/s (≈125-330ms apart)
      }
      k += 2 + random() * 28 // 2-30s pause between bursts
    }
    t = sessionEnd + (continuous ? 0 : 60 + random() * 1140) // 1-20 min away
  }
  return { sessions, keys, end }
}

module.exports = { mulberry32, generateHistory, SAMPLE_TEXT }
