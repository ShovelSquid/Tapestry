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
      }
    }
    return { id, name: raw.name, description: typeof raw.description === 'string' ? raw.description : '', nodes: raw.nodes }
  })
}

/**
 * The commit a preset submits: one createNode per node, in file order.
 * @param {Preset} preset
 * @returns {CreateNodeOp[]}
 */
function presetOps(preset) {
  return preset.nodes.map((node) => ({ op: 'createNode', type: node.type, props: structuredClone(node.props) }))
}

/**
 * One command per preset. The handler submits the nodes and returns the
 * commit result so a caller (or a test) can see the ids.
 * @param {Preset[]} presets
 * @returns {CommandContribution[]}
 */
function presetCommands(presets) {
  return presets.map((preset) => ({
    id: COMMAND_PREFIX + preset.id,
    displayName: `Mathspace preset: ${preset.name}`,
    handler: (context) => context.kernel.submit('plugin', 'mathspace', `preset ${preset.id}`, presetOps(preset)),
  }))
}

module.exports = { loadPresets, presetOps, presetCommands, PRESET_DIR, COMMAND_PREFIX }
