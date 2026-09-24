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
 * only from @tapestry/sdk (PLUG-03). This file is the composition file;
 * engine.js wraps the Wasm ABI and image.js (next) maps kernel nodes to
 * engine actions. The handlers below are the skeleton: they load the
 * engine and log, and the run loop lands with image.js.
 */

/** @typedef {import('@tapestry/sdk').TapestryPlugin} TapestryPlugin */
/** @typedef {import('@tapestry/sdk').PluginContext} PluginContext */
/** @typedef {import('@tapestry/sdk').CommandContribution} CommandContribution */

const { loadModule } = require('./engine')

/** @type {CommandContribution} */
const runCommand = {
  id: 'mathspace.run',
  displayName: 'Mathspace: Run',
  handler: async () => {
    const mod = await loadModule()
    console.log(`[mathspace] engine ABI ${mod._ms_version()} loaded; run loop not wired yet`)
  },
}

/** @type {CommandContribution} */
const pauseCommand = {
  id: 'mathspace.pause',
  displayName: 'Mathspace: Pause',
  handler: async () => {
    console.log('[mathspace] pause: nothing running')
  },
}

/** @type {CommandContribution} */
const stepCommand = {
  id: 'mathspace.step',
  displayName: 'Mathspace: Step',
  handler: async () => {
    const mod = await loadModule()
    console.log(`[mathspace] engine ABI ${mod._ms_version()} loaded; step not wired yet`)
  },
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
    // No timers yet; the run loop will clear its interval here.
  },
}

module.exports = mathspacePlugin
