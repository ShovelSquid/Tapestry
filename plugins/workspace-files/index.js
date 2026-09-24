/**
 * workspace-files — the first-party views for a workspace tree (02.7).
 *
 * The mirror and the file writes are a host service in main, because they
 * need the filesystem and the reserved `workspace.watcher` actor. What a file
 * note looks like is not privileged, so it ships as a plugin through the same
 * public SDK any third-party plugin uses — and disabling it leaves every file
 * note readable through the generic fallback card.
 *
 * Plain CommonJS with no Node or Electron APIs: the host requires it directly,
 * with no build step.
 */

/** @typedef {import('@tapestry/sdk').TapestryPlugin} TapestryPlugin */
/** @typedef {import('@tapestry/sdk').PluginContext} PluginContext */

const nodeViews = [
  {
    nodeType: 'tapestry.workspace/text@1',
    displayName: 'Workspace file',
    component: 'WorkspaceFileCard',
  },
  {
    nodeType: 'tapestry.workspace/file@1',
    displayName: 'Workspace file (not text)',
    component: 'WorkspaceFileCard',
  },
  {
    nodeType: 'tapestry.workspace/folder@1',
    displayName: 'Workspace folder',
    component: 'WorkspaceFolderLabel',
  },
]

/** @type {TapestryPlugin} */
const workspaceFilesPlugin = {
  name: 'workspace-files',
  version: '1',

  /** @param {PluginContext} context */
  activate(context) {
    for (const view of nodeViews) {
      context.registerNodeView(view)
    }
  },

  deactivate() {
    // Nothing to release: the host drops the contributions it registered.
  },
}

module.exports = workspaceFilesPlugin
