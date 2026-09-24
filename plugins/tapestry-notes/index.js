/**
 * tapestry-notes — first-party note plugin for Tapestry.
 *
 * Registers the `tapestry.notes/note@1` node type and its view.
 * This plugin uses the same public SDK API as any third-party plugin (D-27).
 * It does not import Electron or Node.js APIs — only SDK types (via JSDoc).
 *
 * Plugins are plain CommonJS JavaScript so the host can `require()` them
 * directly without a build step (D-29/D-30 development loop). Types come
 * from `@tapestry/sdk` through JSDoc annotations.
 *
 * Per D-30: discovered by the host from plugins/tapestry-notes/tapestry.plugin.json.
 * Per PLUG-06: all durable changes go through kernel.submit().
 */

/** @typedef {import('@tapestry/sdk').TapestryPlugin} TapestryPlugin */
/** @typedef {import('@tapestry/sdk').PluginContext} PluginContext */
/** @typedef {import('@tapestry/sdk').NodeSchema} NodeSchema */

// ---------------------------------------------------------------------------
// Note schema
// ---------------------------------------------------------------------------

/** @type {NodeSchema} */
const noteSchema = {
  type: 'tapestry.notes/note@1',
  displayName: 'Note',
  defaultProperties: {
    'position.x': 'real',
    'position.y': 'real',
    body: 'text',
    title: 'text',
  },
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

/** @type {TapestryPlugin} */
const tapestryNotesPlugin = {
  name: 'tapestry-notes',
  version: '1',

  /** @param {PluginContext} context */
  activate(context) {
    // Register the note node type's view with the host.
    // The renderer maps this to the NoteCard React component.
    context.registerNodeView({
      nodeType: noteSchema.type,
      displayName: noteSchema.displayName,
      component: 'NoteCard',
    })
  },

  deactivate() {
    // No subscriptions or handlers to clean up in this simple plugin.
  },
}

// CommonJS export for require() in the plugin host
module.exports = tapestryNotesPlugin
