/**
 * world.js — kernel nodes to a running engine, the one way in.
 *
 * `buildWorld` is what the runner does before it steps and what the stage
 * surface does before it projects: build the image (image.js), apply its
 * actions to a fresh engine, then compile and bind every `<f>.expr` in a
 * second pass, once every note and field exists so refs resolve. A
 * binding that fails is a problem on its node, never a failure of the
 * build: the rest of the world still runs. The same seed everywhere, so
 * the surface's engine and the runner's agree byte for byte on the same
 * nodes.
 *
 * No `node:` imports here: the surface bundles this file into the
 * renderer alongside engine-core.js.
 */

const { Engine } = require('./engine-core')
const { buildImage, encodeBindField, engineSource, kernelName } = require('./image')

const ENGINE_SEED = 1n

/**
 * @param {Array<object>} nodes kernel.getNodes() output
 * @param {object} mod the loaded Wasm module
 * @returns {{engine: Engine, image: ReturnType<typeof buildImage>}}
 *   the caller owns `engine` and must destroy() it
 */
function buildWorld(nodes, mod) {
  const image = buildImage(nodes)
  const engine = new Engine(mod, ENGINE_SEED)
  for (const action of image.actions) {
    const rc = engine.apply(action)
    if (rc !== 0) {
      engine.destroy()
      throw new Error(`engine rejected an image action with code ${rc}`)
    }
  }
  for (const b of image.bindings) {
    const key = `${kernelName(b.name)}.expr`
    const src = engineSource(b.text)
    const r = engine.compile(b.id, src.text)
    if (r.error !== undefined) {
      image.problems.push({ id: b.node, key, reason: `${r.error} at ${src.back(r.where)}` })
      continue
    }
    const rc = engine.apply(encodeBindField(b.id, b.name, r.code))
    if (rc !== 0) image.problems.push({ id: b.node, key, reason: `bind rejected with code ${rc}` })
  }
  return { engine, image }
}

module.exports = { ENGINE_SEED, buildWorld }
