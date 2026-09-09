/**
 * tapestry-notes — first-party note plugin for Tapestry.
 *
 * Registers the `tapestry.notes/note@1` node type and its view.
 * This plugin uses the same public SDK API as any third-party plugin (D-27).
 * It does not import Electron or Node.js APIs — only SDK types.
 *
 * Per D-30: discovered by the host from plugins/tapestry-notes/tapestry.plugin.json.
 * Per PLUG-06: all durable changes go through kernel.submit().
 */

import type { TapestryPlugin, PluginContext, NodeSchema } from '@tapestry/sdk'

// ---------------------------------------------------------------------------
// Note schema
// ---------------------------------------------------------------------------

const noteSchema: NodeSchema = {
  type: 'tapestry.notes/note@1',
  displayName: 'Note',
  defaultProperties: {
    'position.x': 'real' as any,
    'position.y': 'real' as any,
    body: 'text' as any,
    title: 'text' as any,
  },
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

const tapestryNotesPlugin: TapestryPlugin = {
  name: 'tapestry-notes',
  version: '1',

  activate(context: PluginContext): void {
    // Register the note node type's view with the host.
    // The renderer maps this to the NoteCard React component.
    context.registerNodeView(noteSchema.type, 'NoteCard')
  },

  deactivate(): void {
    // No subscriptions or handlers to clean up in this simple plugin.
  },
}

// CommonJS export for require() in the plugin host
module.exports = tapestryNotesPlugin
