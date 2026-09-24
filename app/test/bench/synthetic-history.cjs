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

/**
 * A short, heavily-edited stretch exercising every ghost/marker kind this
 * plan adds (D-02..D-05): a phrase deleted from the middle (ghosts + a
 * deletion marker), a word typed then undone (a ghost + an undo marker), a
 * paste landing as one cluster (a paste marker), and format/link markers.
 * Used only by `--shots` (visual review), never by `--bench` (fps).
 *
 * @returns {{ keys: [number, string, number | null][], markers: [number, string][], end: number }}
 *   `keys` are `[atSeconds, grapheme, deletedAtSeconds]`; `markers` are
 *   `[atSeconds, kind]`, `kind` one of `MARKER_KINDS` (deletion, undo,
 *   paste, format, link).
 */
function generateEditedStretch() {
  const random = mulberry32(11)
  const keys = []
  const markers = []
  let t = 0

  function typeWord(word) {
    for (const ch of word) {
      keys.push([t, ch, null])
      t += 0.12 + random() * 0.1
    }
  }

  typeWord('Write a paragraph then delete a phrase from the middle ')
  const phraseStart = keys.length
  typeWord('right here ')
  const phraseEnd = keys.length
  typeWord('and keep going. ')
  t += 1
  const deleteAt = t
  for (let i = phraseStart; i < phraseEnd; i++) keys[i][2] = deleteAt
  markers.push([deleteAt, 'deletion'])
  t += 1

  const undoWordStart = keys.length
  typeWord('oops ')
  const undoWordEnd = keys.length
  t += 0.5
  const undoAt = t
  for (let i = undoWordStart; i < undoWordEnd; i++) keys[i][2] = undoAt
  markers.push([undoAt, 'undo'])
  t += 1

  const pasteAt = t
  for (const ch of 'pasted content landing all at once ') keys.push([pasteAt, ch, null])
  markers.push([pasteAt, 'paste'])
  t += 1

  typeWord('a bold word ')
  markers.push([t, 'format'])
  t += 1

  typeWord('a link to Cast ')
  markers.push([t, 'link'])
  t += 1

  return { keys, markers, end: t }
}

module.exports = { mulberry32, generateHistory, generateEditedStretch, SAMPLE_TEXT }
