/**
 * example-plugin — third-party example plugin for Tapestry.
 *
 * Demonstrates how to build a plugin using only the public SDK:
 * - Registers a command "example.inspect" that logs selected node properties
 * - Registers a PropertyPanelContribution for all node types ("*" wildcard)
 * - Registers a SurfaceContribution: a plain ES module under surface/ that the
 *   host imports over the tapestry-plugin scheme (CANV-04), with no build step
 *
 * Plugins are plain CommonJS JavaScript so the host can `require()` them
 * directly without a build step (D-29/D-30 development loop). Types come
 * from `@tapestry/sdk` through JSDoc annotations.
 *
 * Per PLUG-01: this plugin lives in plugins/ and works without modifying
 * or rebuilding the host.
 * Per PLUG-03: imports ONLY from the SDK package — no Electron, no host internals.
 * Per D-27: visible, understandable primitives — this file is the composition
 * file describing how the plugin's pieces fit together (D-28).
 */

/** @typedef {import('@tapestry/sdk').TapestryPlugin} TapestryPlugin */
/** @typedef {import('@tapestry/sdk').PluginContext} PluginContext */
/** @typedef {import('@tapestry/sdk').CommandContribution} CommandContribution */
/** @typedef {import('@tapestry/sdk').PropertyPanelContribution} PropertyPanelContribution */
/** @typedef {import('@tapestry/sdk').SurfaceContribution} SurfaceContribution */

// ---------------------------------------------------------------------------
// Command: example.inspect
// ---------------------------------------------------------------------------

/**
 * The inspect command reads the selected node's properties via the kernel
 * API and logs them to the console. Demonstrates read-only kernel access
 * from a command handler.
 *
 * @type {CommandContribution}
 */
const inspectCommand = {
  id: 'example.inspect',
  displayName: 'Inspect Node Properties',
  handler: async (context) => {
    if (context.selectedNodes.length === 0) {
      console.log('[example-plugin] No node selected')
      return
    }

    for (const nodeId of context.selectedNodes) {
      const node = await context.kernel.getNode(nodeId)
      if (node) {
        console.log(`[example-plugin] Node ${nodeId}:`, {
          type: node.type,
          properties: node.props,
        })
      } else {
        console.log(`[example-plugin] Node ${nodeId} not found`)
      }
    }
  },
}

// ---------------------------------------------------------------------------
// Property panel contribution
// ---------------------------------------------------------------------------

/**
 * A property panel that shows for any node type ("*" wildcard).
 * The component name "ExamplePropertyPanel" is registered by name;
 * the renderer resolves and renders it when a node is selected.
 *
 * @type {PropertyPanelContribution}
 */
const propertyPanel = {
  nodeType: '*',
  displayName: 'Example Inspector',
  component: 'ExamplePropertyPanel',
}

// ---------------------------------------------------------------------------
// Surface contribution
// ---------------------------------------------------------------------------

/**
 * A full-window stage surface. The entry is a plain ES module inside this
 * plugin directory; the host serves it (and the module Worker and .wasm it
 * references) over tapestry-plugin://example-plugin/ and calls its default
 * export's mount(host). No bundler, no host edits.
 *
 * @type {SurfaceContribution}
 */
const exampleSurface = {
  id: 'example.surface',
  displayName: 'Example Surface',
  entry: 'surface/surface.js',
  placement: 'stage',
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

/** @type {TapestryPlugin} */
const examplePlugin = {
  name: 'example-plugin',
  version: '1',

  /** @param {PluginContext} context */
  activate(context) {
    // Register the inspect command
    context.registerCommand(inspectCommand)

    // Register the property panel for all node types
    context.registerPropertyPanel(propertyPanel)

    // Register the stage surface (CANV-04)
    context.registerSurface(exampleSurface)
  },

  deactivate() {
    // No subscriptions or handlers to clean up.
  },
}

// CommonJS export for require() in the plugin host
module.exports = examplePlugin
