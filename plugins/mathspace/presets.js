/**
 * presets.js — the plan's phase 3 presets as commands.
 *
 * Each `presets/<id>.json` is a small world: a rule node and the bodies it
 * acts on, spelled exactly as the .tree spells them (`position.x`,
 * `velocity.y`, `force.expr`, `set.anger.expr`), so a preset's `nodes`
 * are the `props` of `createNode` ops and nothing is translated. The
 * command `mathspace.preset.<id>` submits them as one commit at the
 * positions the file gives (relative to the tree frame origin, like the
 * app's own notes); the user then runs `mathspace.run`. Loading is a
 * directory listing in name order, so the command list is stable and a
 * new preset is one file, no code.
 *
 * A preset is a self-consistent world: every note in it carries every
 * field its rule reads, so the rule reports no RULE-07 skip on a fresh
 * tree. Notes the user already has may lack those fields; the skip count
 * on the rule node then tells them so, which is what RULE-07 is for.
 *
 * A preset that needs a Space (anything above 2D: the view presets) has
 * a problem the kernel sets: a `ref` must name a node that is live when
 * the commit is made, and the kernel assigns ids at commit time, so no
 * op can point at a node of its own commit. A preset therefore spells a
 * ref to one of its own nodes as `{ "type": "ref", "value": "$<index>" }`
 * (the node's position in `nodes`), and the command submits two commits:
 * first the nodes nobody points at with a `$` ref of their own, then the
 * rest with `$k` replaced by the id the first commit returned. The
 * `.tree` shows the space created one commit before its members, which
 * is what a person would have done by hand.
 */

const { readdirSync, readFileSync } = require('node:fs')
const { join, basename } = require('node:path')

/** @typedef {import('@tapestry/sdk').CommandContribution} CommandContribution */
/** @typedef {import('@tapestry/sdk').CreateNodeOp} CreateNodeOp */

const PRESET_DIR = join(__dirname, 'presets')
const COMMAND_PREFIX = 'mathspace.preset.'

/**
 * @typedef {{ id: string, name: string, description: string,
 *   nodes: Array<{ type: string, props: object }> }} Preset
 */

/**
 * Read every `<id>.json` under `dir` in name order. A file that is not a
 * preset (bad JSON, no `name`, `nodes` not a list of typed nodes) throws
 * with its name: a broken shipped file is a build error, not a command
 * that quietly does nothing.
 * @param {string} [dir]
 * @returns {Preset[]}
 */
function loadPresets(dir = PRESET_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  return files.map((file) => {
    const id = basename(file, '.json')
    let raw
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (err) {
      throw new Error(`preset ${file}: ${err.message}`)
    }
    if (typeof raw.name !== 'string' || raw.name === '') throw new Error(`preset ${file}: missing name`)
    if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) throw new Error(`preset ${file}: nodes must be a non-empty list`)
    for (const [i, node] of raw.nodes.entries()) {
      if (typeof node.type !== 'string' || node.props === null || typeof node.props !== 'object') {
        throw new Error(`preset ${file}: node ${i} needs a type and props`)
      }
      for (const [key, prop] of Object.entries(node.props)) {
        if (prop === null || typeof prop !== 'object' || typeof prop.type !== 'string' || prop.value === undefined) {
          throw new Error(`preset ${file}: node ${i} prop ${key} needs { type, value }`)
        }
        const target = localRef(prop)
        if (target === null) continue
        if (!Number.isInteger(target) || target < 0 || target >= raw.nodes.length || target === i) {
          throw new Error(`preset ${file}: node ${i} prop ${key} refers to node ${prop.value}, which is not another node of the preset`)
        }
        if (hasLocalRef(raw.nodes[target])) {
          throw new Error(`preset ${file}: node ${i} prop ${key} refers to node ${target}, which has local refs of its own (only one level is resolved)`)
        }
      }
    }
    return { id, name: raw.name, description: typeof raw.description === 'string' ? raw.description : '', nodes: raw.nodes }
  })
}

/**
 * The index a `$k` ref prop points at, or null when the prop is not one.
 * @param {{ type: string, value: unknown }} prop
 * @returns {number | null}
 */
function localRef(prop) {
  if (prop.type !== 'ref' || typeof prop.value !== 'string' || prop.value[0] !== '$') return null
  return /^\$\d+$/.test(prop.value) ? Number(prop.value.slice(1)) : NaN
}

const hasLocalRef = (node) => Object.values(node.props).some((prop) => localRef(prop) !== null)

/**
 * The op that creates `node`, with every `$k` ref replaced through `ids`
 * (preset index → kernel id); a `$k` whose id is not known yet is left
 * as written.
 * @param {{ type: string, props: object }} node
 * @param {Map<number, string>} ids
 * @returns {CreateNodeOp}
 */
function createOp(node, ids) {
  const props = structuredClone(node.props)
  for (const prop of Object.values(props)) {
    const target = localRef(prop)
    if (target !== null && ids.has(target)) prop.value = ids.get(target)
  }
  return { op: 'createNode', type: node.type, props }
}

/**
 * Submit a preset: the nodes without local refs in one commit, then the
 * nodes with local refs in a second, pointing at the ids the first
 * returned. The result looks like one submit's, with `nodeIds` in preset
 * order, so the caller sees every node it created.
 * @param {import('@tapestry/sdk').KernelApi} kernel
 * @param {Preset} preset
 */
async function applyPreset(kernel, preset) {
  const first = []
  const second = []
  preset.nodes.forEach((node, index) => (hasLocalRef(node) ? second : first).push(index))
  const ids = new Map()
  let result = null
  for (const [batch, suffix] of [[first, ''], [second, ' members']]) {
    if (batch.length === 0) continue
    const ops = batch.map((index) => createOp(preset.nodes[index], ids))
    result = await kernel.submit('plugin', 'mathspace', `preset ${preset.id}${suffix}`, ops)
    batch.forEach((index, k) => ids.set(index, result.nodeIds[k]))
  }
  return { ...result, nodeIds: preset.nodes.map((_, index) => ids.get(index)) }
}

/**
 * The ops a preset submits, in file order, with `$k` refs still unresolved
 * (for listing and tests; `applyPreset` is what the command runs).
 * @param {Preset} preset
 * @returns {CreateNodeOp[]}
 */
function presetOps(preset) {
  return preset.nodes.map((node) => createOp(node, new Map()))
}

/**
 * One command per preset. The handler submits the nodes and returns the
 * (last) commit result with every node id so a caller (or a test) can
 * see what it made.
 * @param {Preset[]} presets
 * @returns {CommandContribution[]}
 */
function presetCommands(presets) {
  return presets.map((preset) => ({
    id: COMMAND_PREFIX + preset.id,
    displayName: `Mathspace preset: ${preset.name}`,
    handler: (context) => applyPreset(context.kernel, preset),
  }))
}

module.exports = { loadPresets, presetOps, applyPreset, presetCommands, PRESET_DIR, COMMAND_PREFIX }
