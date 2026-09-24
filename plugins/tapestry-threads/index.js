/**
 * tapestry-threads — first-party thread plugin for Tapestry (D-01, D-06).
 *
 * Registers the `tapestry.threads/thread@1` node type and its view, through
 * the same public SDK API tapestry-notes uses (D-27) — a normal feature
 * requires no core fork.
 *
 * Plain CommonJS, like tapestry-notes: plugins are require()d directly by
 * the host with no build step (app/src/main/plugin-host.ts only loads
 * .js/.cjs files), so this manifest cannot import
 * app/src/shared/threads/settings.ts — the type names below are duplicated
 * from it deliberately, the same way tapestry-notes hardcodes its own
 * schema inline; settings.ts is the single source of truth for the values,
 * this file only names their types.
 *
 * Per D-30: discovered by the host from plugins/tapestry-threads/tapestry.plugin.json.
 * Per PLUG-06: all durable changes go through kernel.submit() (here, via
 * ThreadService's own submitAs calls in main — see thread-service.ts).
 */

/** @typedef {import('@tapestry/sdk').TapestryPlugin} TapestryPlugin */
/** @typedef {import('@tapestry/sdk').PluginContext} PluginContext */
/** @typedef {import('@tapestry/sdk').NodeSchema} NodeSchema */

// ---------------------------------------------------------------------------
// Thread schema
// ---------------------------------------------------------------------------

/** @type {NodeSchema} */
const threadSchema = {
  type: 'tapestry.threads/thread@1',
  displayName: 'Thread',
  defaultProperties: {
    'position.x': 'real',
    'position.y': 'real',
    'thread.origin.x': 'real',
    'thread.origin.y': 'real',
    'thread.origin.z': 'real',
    'thread.direction.x': 'real',
    'thread.direction.y': 'real',
    'thread.direction.z': 'real',
    'thread.roll': 'real',
    'thread.timeout': 'real',
    'thread.slowdown': 'text',
    'thread.format': 'int',
    body: 'text',
    title: 'text',
  },
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

/** @type {TapestryPlugin} */
const tapestryThreadsPlugin = {
  name: 'tapestry-threads',
  version: '1',

  /** @param {PluginContext} context */
  activate(context) {
    // Register the thread node type's view with the host. The renderer maps
    // this to the ThreadCard React component (D-09's canvas-level card; the
    // live typer is the separate ThreadOverlay, opened on click).
    context.registerNodeView({
      nodeType: threadSchema.type,
      displayName: threadSchema.displayName,
      component: 'ThreadCard',
    })
  },

  deactivate() {
    // No subscriptions or handlers to clean up: ThreadService (main) is a
    // host service, not plugin-owned state (RESEARCH Pattern 6).
  },
}

// CommonJS export for require() in the plugin host
module.exports = tapestryThreadsPlugin
