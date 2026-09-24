/**
 * projection.js — every note through every view, for the stage surface.
 *
 * `projectAll` asks the engine for `project(view, note)` over the image's
 * views and Note-kind notes, in id order, and returns plain numbers: the
 * surface draws, it never hashes, so reals are fine here and BigInt never
 * crosses into the drawing code. A view that cannot project anything on
 * its own account (no `project.expr`, a compile problem, or a projection
 * that is not dim 2) carries `error` and no note has a point in it; a
 * note that fails under a working view (outside the view's space, or
 * missing a field the expression reads) is `null` in that view and the
 * other views still place it. Pure over the engine and the image: no
 * Electron, no DOM, so the Vitest runs it against the real Wasm in Node.
 */

const { nodeIdToU64, rawToReal } = require('./image')

/**
 * Failures that are the view's fault whatever note is asked about: no
 * bound `project`, or one that is not a map to the plane. Probing the view
 * with itself as `self` (always in its own space) tells them apart from
 * per-note failures.
 */
const VIEW_ERRORS = new Set(['world:NoSuchField', 'world:BadDim'])

/**
 * @param {import('./engine-core').Engine} engine built by world.js
 * @param {{notes: string[], views: string[], problems: Array<{id: string, key: string, reason: string}>}} image
 * @returns {{
 *   views: Array<{id: string, error?: string}>,
 *   points: Array<{id: string, byView: Record<string, [number, number] | null>}>,
 * }}
 */
function projectAll(engine, image) {
  const views = []
  const working = []
  for (const id of image.views) {
    const problem = image.problems.find((p) => p.id === id && p.key === 'project.expr')
    const probe = problem ? { error: problem.reason } : engine.project(nodeIdToU64(id), nodeIdToU64(id))
    if (problem || (probe.error !== undefined && VIEW_ERRORS.has(probe.error))) {
      views.push({ id, error: probe.error })
      continue
    }
    views.push({ id })
    working.push(id)
  }
  const points = []
  for (const id of image.notes) {
    const byView = {}
    const note = nodeIdToU64(id)
    for (const v of working) {
      const r = engine.project(nodeIdToU64(v), note)
      byView[v] = r.error !== undefined ? null : toPoint(r.lanes)
    }
    points.push({ id, byView })
  }
  return { views, points }
}

/** Two raw lanes to reals; a value past ±2^53 is off any page, so null. */
function toPoint(lanes) {
  try {
    return [rawToReal(lanes[0]), rawToReal(lanes[1])]
  } catch {
    return null
  }
}

module.exports = { projectAll, VIEW_ERRORS }
