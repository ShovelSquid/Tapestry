/**
 * mathspace — the deterministic rule engine as a Tapestry plugin.
 *
 * The engine (src/mathspace, built to wasm/mathspace.mjs by
 * `npm run engine:wasm`) owns a derived image of the world's spatial notes;
 * the .tree stays the durable state. Commands:
 *
 *   mathspace.run    build the image from the kernel and step at 60 Hz,
 *                    committing position changes back through kernel.submit
 *   mathspace.pause  stop stepping and commit what has moved
 *   mathspace.step   one tick, then commit
 *   mathspace.preset.<id>
 *                    create the nodes of presets/<id>.json (two commits when the preset has its own Space)
 *
 * The stage surface (surface/, built to surface/dist/surface.js by
 * `npm run build`) draws every View node's projection of its space; it
 * reads the tree through the renderer and never writes.
 *
 * Plugins are plain CommonJS so the host can require() them, and import
 * only from @tapestry/sdk (PLUG-03). This file is the composition file:
 * engine.js wraps the Wasm ABI, image.js maps kernel nodes to engine
 * actions and snapshots back to ops, runner.js is the loop and the
 * commit cadence, presets.js turns presets/*.json into commands.
 */

/** @typedef {import('@tapestry/sdk').TapestryPlugin} TapestryPlugin */
/** @typedef {import('@tapestry/sdk').PluginContext} PluginContext */
/** @typedef {import('@tapestry/sdk').CommandContribution} CommandContribution */
/** @typedef {import('@tapestry/sdk').SurfaceContribution} SurfaceContribution */

const { loadModule } = require('./engine')
const { Runner } = require('./runner')
const { loadPresets, presetCommands } = require('./presets')

/** One run loop for the plugin's lifetime; each command hands it the kernel. */
const runner = new Runner({ loadModule })

/** @type {CommandContribution} */
const runCommand = {
  id: 'mathspace.run',
  displayName: 'Mathspace: Run',
  handler: (context) => runner.start(context.kernel),
}

/** @type {CommandContribution} */
const pauseCommand = {
  id: 'mathspace.pause',
  displayName: 'Mathspace: Pause',
  handler: (context) => runner.pause(context.kernel),
}

/** @type {CommandContribution} */
const stepCommand = {
  id: 'mathspace.step',
  displayName: 'Mathspace: Step',
  handler: (context) => runner.stepOnce(context.kernel),
}

/** @type {SurfaceContribution} */
const stageSurface = {
  id: 'mathspace.stage',
  displayName: 'Mathspace',
  entry: 'surface/dist/surface.js',
  placement: 'stage',
}

/** The presets directory is read once, when the host requires this file. */
const presets = presetCommands(loadPresets())

/** @type {TapestryPlugin} */
const mathspacePlugin = {
  name: 'mathspace',
  version: '1',

  /** @param {PluginContext} context */
  activate(context) {
    context.registerCommand(runCommand)
    context.registerCommand(pauseCommand)
    context.registerCommand(stepCommand)
    for (const command of presets) context.registerCommand(command)
    context.registerSurface(stageSurface)
  },

  deactivate() {
    runner.dispose()
  },
}

module.exports = mathspacePlugin
