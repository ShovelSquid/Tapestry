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
 * The surface is registered through the public extension point (CANV-04):
 * the host lists it as "Open Data Drawing", serves surface/dist/ over
 * tapestry-plugin://data-drawing/ and calls the module's default mount(host).
 * The same dist/ is what the plugin's own dev page mounts
 * (`npm --prefix plugins/data-drawing run dev`).
 */

/** @typedef {import('@tapestry/sdk').TapestryPlugin} TapestryPlugin */
/** @typedef {import('@tapestry/sdk').PluginContext} PluginContext */
/** @typedef {import('@tapestry/sdk').SurfaceContribution} SurfaceContribution */

// ---------------------------------------------------------------------------
// Surface contribution
// ---------------------------------------------------------------------------

/**
 * The painting surface: a full-window stage layer. The entry is the Vite
 * library build of surface/src/main.ts (`npm --prefix plugins/data-drawing
 * run build`); the module Worker chunk and mathspace.wasm it references sit
 * next to it under surface/dist/assets/ and load over the same origin.
 *
 * @type {SurfaceContribution}
 */
const canvasSurface = {
  id: 'datadrawing.canvas',
  displayName: 'Data Drawing',
  entry: 'surface/dist/surface.js',
  placement: 'stage',
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

/** @type {TapestryPlugin} */
const dataDrawingPlugin = {
  name: 'data-drawing',
  version: '1',

  /** @param {PluginContext} context */
  activate(context) {
    // Register the stage surface (CANV-04)
    context.registerSurface(canvasSurface)
  },

  deactivate() {
    // The surface's own dispose() (called by the host on unmount) releases
    // its Worker and listeners; nothing is held here.
  },
}

// CommonJS export for require() in the plugin host
module.exports = dataDrawingPlugin
