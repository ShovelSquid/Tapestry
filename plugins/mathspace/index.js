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
 *
 * Plugins are plain CommonJS so the host can require() them, and import
 * only from @tapestry/sdk (PLUG-03). This file is the composition file:
 * engine.js wraps the Wasm ABI, image.js maps kernel nodes to engine
 * actions and snapshots back to ops, runner.js is the loop and the
 * commit cadence.
 */

/** @typedef {import('@tapestry/sdk').TapestryPlugin} TapestryPlugin */
/** @typedef {import('@tapestry/sdk').PluginContext} PluginContext */
/** @typedef {import('@tapestry/sdk').CommandContribution} CommandContribution */

const { loadModule } = require('./engine')
const { Runner } = require('./runner')

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

/** @type {TapestryPlugin} */
const mathspacePlugin = {
  name: 'mathspace',
  version: '1',

  /** @param {PluginContext} context */
  activate(context) {
    context.registerCommand(runCommand)
    context.registerCommand(pauseCommand)
    context.registerCommand(stepCommand)
  },

  deactivate() {
    runner.dispose()
  },
}

module.exports = mathspacePlugin
