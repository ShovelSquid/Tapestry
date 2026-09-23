/**
 * data-drawing — the Data Drawing painting surface as a Tapestry plugin.
 *
 * Plugins are plain CommonJS JavaScript so the host can `require()` them
 * directly without a build step. Types come from `@tapestry/sdk` through
 * JSDoc annotations.
 *
 * Per PLUG-03: imports ONLY from the SDK package — no Electron, no host
 * internals. The painting surface itself (surface/src/main.ts, built to
 * surface/dist/surface.js) runs the fixed-point sim as WebAssembly inside a
 * module Worker and never touches Electron either.
 *
 * Nothing is registered yet: `registerSurface` is called here in 01-06, once
 * the SDK's surface contribution (01-02) and the host's surface layer (01-04)
 * exist. Until then the surface is exercised through its own Vite dev page
 * (`npm --prefix plugins/data-drawing run dev`).
 */

/** @typedef {import('@tapestry/sdk').TapestryPlugin} TapestryPlugin */
/** @typedef {import('@tapestry/sdk').PluginContext} PluginContext */

/** @type {TapestryPlugin} */
const dataDrawingPlugin = {
  name: 'data-drawing',
  version: '1',

  /** @param {PluginContext} context */
  activate(context) {
    // 01-06: context.registerSurface({ id: 'datadrawing.canvas', ... })
    void context
  },

  deactivate() {
    // No subscriptions or handlers to clean up yet.
  },
}

// CommonJS export for require() in the plugin host
module.exports = dataDrawingPlugin
