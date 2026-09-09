/**
 * PluginHost — discovers, loads, and manages the lifecycle of Tapestry plugins.
 *
 * On startup, scans the plugins/ directory for subdirectories containing a
 * tapestry.plugin.json manifest. Parses each manifest, loads the plugin's
 * main entry, and calls activate() with a PluginContext that provides kernel
 * access and host registration methods.
 *
 * Per D-30: local installation follows the Minecraft-mods mental model —
 * place a plugin folder in plugins/ and launch Tapestry.
 * Per D-27: plugins describe their pieces through visible primitives.
 */

import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import type { IpcMain } from 'electron'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PluginManifest {
  name: string
  version: string
  displayName: string
  main: string
  api: string
  contributions: {
    nodeTypes: string[]
    commands?: string[]
  }
}

interface LoadedPlugin {
  manifest: PluginManifest
  instance: any
  nodeViews: Map<string, string>
}

// ---------------------------------------------------------------------------
// PluginHost
// ---------------------------------------------------------------------------

export class PluginHost {
  private plugins: Map<string, LoadedPlugin> = new Map()
  private pluginsDir: string

  constructor(pluginsDir: string) {
    this.pluginsDir = pluginsDir
  }

  /**
   * Scan the plugins directory and load all discovered plugins.
   * Each plugin's activate() receives a PluginContext with kernel access.
   */
  async discover(kernelBridge: any): Promise<void> {
    if (!existsSync(this.pluginsDir)) {
      return
    }

    const entries = readdirSync(this.pluginsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const manifestPath = join(this.pluginsDir, entry.name, 'tapestry.plugin.json')
      if (!existsSync(manifestPath)) continue

      try {
        const raw = readFileSync(manifestPath, 'utf-8')
        const manifest: PluginManifest = JSON.parse(raw)

        // Resolve the main entry relative to the plugin directory
        const entryPath = resolve(this.pluginsDir, entry.name, manifest.main)

        // Load the plugin module
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(entryPath)
        const plugin = mod.default || mod

        const nodeViews = new Map<string, string>()

        // Build the PluginContext per the SDK contract
        const context = {
          kernel: {
            submit: (actorKind: string, actorId: string, message: string, ops: any[]) =>
              kernelBridge.submit(actorKind, actorId, message, ops),
            getNodes: () => kernelBridge.getNodes(),
            getNode: (id: string) => kernelBridge.getNode(id),
            getEdges: () => kernelBridge.getEdges(),
            status: () => kernelBridge.status(),
          },
          registerNodeView: (nodeType: string, component: string) => {
            nodeViews.set(nodeType, component)
          },
        }

        // Call activate
        if (typeof plugin.activate === 'function') {
          await plugin.activate(context)
        }

        this.plugins.set(manifest.name, {
          manifest,
          instance: plugin,
          nodeViews,
        })
      } catch (err) {
        // D-33: a missing or broken plugin never prevents a world from opening.
        // Log the error but continue loading other plugins.
        console.error(`[PluginHost] Failed to load plugin from ${entry.name}:`, err)
      }
    }
  }

  /**
   * Return a list of loaded plugins and their contributions.
   */
  list(): Array<{
    name: string
    displayName: string
    version: string
    nodeTypes: string[]
    nodeViews: Record<string, string>
  }> {
    const result: Array<{
      name: string
      displayName: string
      version: string
      nodeTypes: string[]
      nodeViews: Record<string, string>
    }> = []

    for (const [, loaded] of this.plugins) {
      const views: Record<string, string> = {}
      for (const [type, component] of loaded.nodeViews) {
        views[type] = component
      }
      result.push({
        name: loaded.manifest.name,
        displayName: loaded.manifest.displayName,
        version: loaded.manifest.version,
        nodeTypes: loaded.manifest.contributions.nodeTypes,
        nodeViews: views,
      })
    }

    return result
  }

  /**
   * Register IPC handlers for plugin queries.
   */
  static registerHandlers(ipcMain: IpcMain, host: PluginHost): void {
    ipcMain.handle('plugin:list', () => {
      return host.list()
    })
  }
}
