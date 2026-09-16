/**
 * obsidian-vault — the first-party views for a mirrored vault tree.
 *
 * The bridge itself is a host service in main, because it needs the filesystem
 * and the reserved `obsidian.bridge` actor. What a vault note *looks like* is
 * not privileged, so it ships as a plugin through the same public SDK any
 * third-party plugin uses (D-27) — and because it is a plugin, disabling it
 * leaves every vault note readable through the generic fallback card rather
 * than leaving the frame empty (D-33/D-35).
 *
 * Plain CommonJS with no Node or Electron APIs: the host requires it directly,
 * with no build step (D-29/D-30).
 */

/** @typedef {import('@tapestry/sdk').TapestryPlugin} TapestryPlugin */
/** @typedef {import('@tapestry/sdk').PluginContext} PluginContext */

/**
 * Each vault node type and the component name the renderer maps it to.
 *
 * Only `VaultNoteCard` has a component in this build; the other three names are
 * registered now and drawn in Plan 09. A name the renderer cannot map falls
 * back to the generic card, which stays readable — that is the point of the
 * name being a string rather than a component.
 */
const nodeViews = [
  {
    nodeType: 'obsidian.vault/note@1',
    displayName: 'Vault note',
    component: 'VaultNoteCard',
  },
  {
    nodeType: 'obsidian.vault/folder@1',
    displayName: 'Vault folder',
    component: 'FolderGroup',
  },
  {
    nodeType: 'obsidian.vault/file@1',
    displayName: 'Vault file',
    component: 'FileNote',
  },
  {
    nodeType: 'obsidian.vault/placeholder@1',
    displayName: 'Unwritten note',
    component: 'PlaceholderNote',
  },
]

/** @type {TapestryPlugin} */
const obsidianVaultPlugin = {
  name: 'obsidian-vault',
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

module.exports = obsidianVaultPlugin
