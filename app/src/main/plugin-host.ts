/**
 * PluginHost — discovers, loads, manages lifecycle, and records effects for
 * Tapestry plugins.
 *
 * Per D-30: local installation follows the Minecraft-mods mental model —
 * place a plugin folder in plugins/ and launch Tapestry.
 * Per D-27: plugins describe their pieces through visible primitives.
 * Per D-28: each plugin has a readable manifest and a composition file.
 * Per D-29: reload is explicit by default.
 * Per D-31: plugins cannot access raw journal bytes.
 * Per D-32: enable/disable events are recorded as journal entries.
 * Per D-33: a broken plugin never prevents the world from opening.
 * Per D-34: crash handling with auto-restart, then disable.
 */

import { readdirSync, readFileSync, existsSync } from 'fs'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import type { IpcMain } from 'electron'
import type {
  NodeViewContribution,
  CommandContribution,
  PropertyPanelContribution,
  InspectorContribution,
} from '../../../sdk/src/contributions'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Supported API versions. Phase 2 only supports version "1". */
const SUPPORTED_API_VERSIONS = ['1']

/**
 * A plugin name is a single path segment: it is joined into a filesystem
 * path under plugins/ and drives require(), so it must never contain
 * separators, "..", or leading dots. Names arrive unvalidated over IPC.
 */
const PLUGIN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Whether a plugin name is safe to use as a directory name under plugins/. */
export function isValidPluginName(name: unknown): name is string {
  return typeof name === 'string' && PLUGIN_NAME_RE.test(name) && !name.includes('..')
}

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

type PluginStatus = 'loaded' | 'failed' | 'disabled' | 'incompatible'

interface PluginLoadResult {
  status: PluginStatus
  reason?: string
}

interface ContributionRegistry {
  nodeViews: Map<string, NodeViewContribution>
  commands: Map<string, CommandContribution>
  propertyPanels: Map<string, PropertyPanelContribution[]>
  inspectors: Map<string, InspectorContribution>
}

interface LoadedPlugin {
  manifest: PluginManifest
  instance: any
  status: PluginStatus
  reason?: string
  contributions: ContributionRegistry
}

// ---------------------------------------------------------------------------
// PluginHost
// ---------------------------------------------------------------------------

export class PluginHost {
  private plugins: Map<string, LoadedPlugin> = new Map()
  private pluginsDir: string
  private kernelBridge: any = null

  /** Callback to notify the renderer of plugin errors (set by main process). */
  onPluginError: ((pluginName: string, error: string, canRestart: boolean) => void) | null = null

  constructor(pluginsDir: string) {
    this.pluginsDir = pluginsDir
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  /**
   * Scan the plugins directory for subdirectories containing a
   * tapestry.plugin.json manifest. Parse and validate each manifest.
   * Per D-30: each subdirectory with a manifest is a plugin candidate.
   */
  discoverPlugins(): PluginManifest[] {
    if (!existsSync(this.pluginsDir)) {
      return []
    }

    const manifests: PluginManifest[] = []
    const entries = readdirSync(this.pluginsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const manifestPath = join(this.pluginsDir, entry.name, 'tapestry.plugin.json')
      if (!existsSync(manifestPath)) continue

      try {
        const raw = readFileSync(manifestPath, 'utf-8')
        const manifest: PluginManifest = JSON.parse(raw)

        // Validate required fields (T-02-10: malformed manifest protection)
        if (!manifest.name || !manifest.version || !manifest.main) {
          console.warn(
            `[PluginHost] Skipping ${entry.name}: manifest missing required fields (name, version, main)`,
          )
          continue
        }

        // Default api to empty string if missing (will fail version check)
        if (!manifest.api) {
          manifest.api = ''
        }

        // Default contributions
        if (!manifest.contributions) {
          manifest.contributions = { nodeTypes: [] }
        }

        manifests.push(manifest)
      } catch (err) {
        // T-02-10: malformed manifest logged and skipped
        console.warn(`[PluginHost] Skipping ${entry.name}: invalid manifest JSON`, err)
      }
    }

    return manifests
  }

  // -------------------------------------------------------------------------
  // Load / Unload lifecycle
  // -------------------------------------------------------------------------

  /**
   * Load a single plugin by name. Validates API version, loads the entry
   * module, constructs a PluginContext, and calls activate().
   *
   * Per D-34: errors during activate are caught; the plugin is marked failed.
   * Per PLUG-05: version mismatch prevents loading with a clear reason.
   * Per D-31: the KernelAPI has no journal-level methods.
   */
  async loadPlugin(name: string): Promise<PluginLoadResult> {
    if (!this.kernelBridge) {
      return { status: 'failed', reason: 'No kernel bridge available' }
    }

    // Resolve the plugin directory; rejects names that would escape plugins/
    const pluginDir = this.resolvePluginDir(name)
    if (!pluginDir) {
      return { status: 'failed', reason: 'Invalid plugin name' }
    }

    // Find the manifest on disk
    const manifestPath = join(pluginDir, 'tapestry.plugin.json')
    if (!existsSync(manifestPath)) {
      return { status: 'failed', reason: `Manifest not found at ${manifestPath}` }
    }

    let manifest: PluginManifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (err) {
      return { status: 'failed', reason: `Invalid manifest JSON: ${err}` }
    }

    // PLUG-05: Version compatibility check
    if (!manifest.api || !SUPPORTED_API_VERSIONS.includes(manifest.api)) {
      const reason = manifest.api
        ? `Plugin requires API version ${manifest.api}, host supports version ${SUPPORTED_API_VERSIONS.join(', ')}`
        : 'Plugin manifest missing api field'

      const loadResult: PluginLoadResult = { status: 'incompatible', reason }

      this.plugins.set(name, {
        manifest,
        instance: null,
        status: 'incompatible',
        reason,
        contributions: this.createEmptyRegistry(),
      })

      console.warn(`[PluginHost] ${name}: ${reason}`)
      return loadResult
    }

    // Resolve the main entry relative to the plugin directory
    const entryPath = resolve(pluginDir, manifest.main)
    const relativeEntryPath = relative(pluginDir, entryPath)
    if (relativeEntryPath.startsWith('..') || isAbsolute(relativeEntryPath)) {
      return { status: 'failed', reason: 'Plugin entry path escapes plugin directory' }
    }

    // The host loads plugins with Node's require(), which cannot parse
    // TypeScript. Refuse non-JS entries up front with an actionable reason
    // instead of a SyntaxError deep inside require().
    if (!/\.c?js$/.test(entryPath)) {
      return {
        status: 'failed',
        reason: `Plugin entry must be a .js/.cjs file (got ${manifest.main}); build the plugin first`,
      }
    }

    try {
      // Load the plugin module
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(entryPath)
      const plugin = mod.default || mod

      const contributions = this.createEmptyRegistry()

      // Build the PluginContext per the SDK contract
      // D-31: KernelAPI has NO journal-level methods (no raw read/write/truncate/repair/saveAs)
      const context = {
        kernel: {
          submit: (actorKind: string, actorId: string, message: string, ops: any[]) =>
            this.kernelBridge.submit(actorKind, actorId, message, ops),
          getNodes: () => this.kernelBridge.getNodes(),
          getNode: (id: string) => this.kernelBridge.getNode(id),
          getEdges: () => this.kernelBridge.getEdges(),
          status: () => this.kernelBridge.status(),
        },
        registerNodeView: (contribution: NodeViewContribution) => {
          contributions.nodeViews.set(contribution.nodeType, contribution)
        },
        registerCommand: (contribution: CommandContribution) => {
          contributions.commands.set(contribution.id, contribution)
        },
        registerPropertyPanel: (contribution: PropertyPanelContribution) => {
          const existing = contributions.propertyPanels.get(contribution.nodeType) || []
          existing.push(contribution)
          contributions.propertyPanels.set(contribution.nodeType, existing)
        },
        registerInspector: (contribution: InspectorContribution) => {
          contributions.inspectors.set(contribution.id, contribution)
        },
      }

      // D-34: wrap activate in try-catch
      if (typeof plugin.activate === 'function') {
        await plugin.activate(context)
      }

      this.plugins.set(name, {
        manifest,
        instance: plugin,
        status: 'loaded',
        contributions,
      })

      return { status: 'loaded' }
    } catch (err) {
      // D-33/D-34: broken plugin does not crash the host
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`[PluginHost] Failed to load plugin ${name}:`, err)

      this.plugins.set(name, {
        manifest,
        instance: null,
        status: 'failed',
        reason,
        contributions: this.createEmptyRegistry(),
      })

      return { status: 'failed', reason }
    }
  }

  /**
   * Unload a plugin: call deactivate(), remove contributions, release refs.
   * Per D-34: errors during deactivate are caught.
   */
  async unloadPlugin(name: string): Promise<void> {
    const loaded = this.plugins.get(name)
    if (!loaded) return

    // Call deactivate if available
    if (loaded.instance && typeof loaded.instance.deactivate === 'function') {
      try {
        await loaded.instance.deactivate()
      } catch (err) {
        console.error(`[PluginHost] Error during deactivate of ${name}:`, err)
      }
    }

    // Remove all contributions
    loaded.contributions.nodeViews.clear()
    loaded.contributions.commands.clear()
    loaded.contributions.propertyPanels.clear()
    loaded.contributions.inspectors.clear()

    // Clear the require cache so a reload gets fresh code
    const pluginDir = this.resolvePluginDir(name)
    if (pluginDir) {
      const entryPath = resolve(pluginDir, loaded.manifest.main)
      try {
        delete require.cache[require.resolve(entryPath)]
      } catch {
        // Plugin files may already be gone from disk.
      }
    }

    this.plugins.delete(name)
  }

  // -------------------------------------------------------------------------
  // Reload (D-29: explicit by default)
  // -------------------------------------------------------------------------

  /**
   * Reload a plugin by unloading then loading it.
   * Per D-29: reload is explicit — the developer triggers it.
   */
  async reloadPlugin(name: string): Promise<PluginLoadResult> {
    await this.unloadPlugin(name)
    return this.loadPlugin(name)
  }

  // -------------------------------------------------------------------------
  // Enable / Disable (D-32: recorded in journal)
  // -------------------------------------------------------------------------

  /**
   * Enable a plugin: load it and record the event in the .tree journal.
   * Per D-32: enable is recorded as a journal event through kernel.submit
   * with actor kind "system" and actor id "tapestry".
   */
  async enablePlugin(name: string): Promise<PluginLoadResult> {
    const result = await this.loadPlugin(name)

    // Record the enable event in the journal (D-32)
    if (this.kernelBridge && this.kernelBridge.isLoaded) {
      try {
        await this.kernelBridge.submit('system', 'tapestry', `enabled plugin ${name}`, [])
      } catch (err) {
        console.error(`[PluginHost] Failed to record enable event for ${name}:`, err)
      }
    }

    return result
  }

  /**
   * Disable a plugin: unload it and record the event in the .tree journal.
   * Per D-32: disable is recorded as a journal event.
   * Per D-35: disabled plugin content remains readable through fallback.
   */
  async disablePlugin(name: string): Promise<void> {
    await this.unloadPlugin(name)

    // Record the disable event in the journal (D-32)
    if (this.kernelBridge && this.kernelBridge.isLoaded) {
      try {
        await this.kernelBridge.submit('system', 'tapestry', `disabled plugin ${name}`, [])
      } catch (err) {
        console.error(`[PluginHost] Failed to record disable event for ${name}:`, err)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Crash handling (D-34)
  // -------------------------------------------------------------------------

  /**
   * Handle a plugin crash: attempt one automatic restart, then disable.
   * Per D-34: notify immediately, restart once, then disable with
   * Restart/Dismiss actions.
   */
  async handlePluginCrash(name: string, error: string): Promise<void> {
    // Notify renderer immediately
    if (this.onPluginError) {
      const displayName = this.plugins.get(name)?.manifest.displayName || name
      this.onPluginError(displayName, `${displayName} stopped working. Restarting...`, false)
    }

    // Record crash event in journal
    if (this.kernelBridge && this.kernelBridge.isLoaded) {
      try {
        await this.kernelBridge.submit('system', 'tapestry', `plugin ${name} crashed: ${error}`, [])
      } catch {
        // Best effort
      }
    }

    // Attempt one automatic restart
    await this.unloadPlugin(name)
    const result = await this.loadPlugin(name)

    if (result.status === 'loaded') {
      // Restart succeeded — notify dismissal after delay
      if (this.onPluginError) {
        const displayName = this.plugins.get(name)?.manifest.displayName || name
        this.onPluginError(displayName, '', false) // signal: clear notification
      }
    } else {
      // Restart failed — disable and show Restart/Dismiss
      const loaded = this.plugins.get(name)
      if (loaded) {
        loaded.status = 'failed'
        loaded.reason = result.reason || 'Restart failed'
      }

      if (this.onPluginError) {
        const displayName = loaded?.manifest.displayName || name
        this.onPluginError(
          displayName,
          `${displayName} could not restart. Your work is safe.`,
          true,
        )
      }
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Get the full contribution registry across all loaded plugins.
   */
  getContributions(): {
    nodeViews: Record<string, NodeViewContribution>
    commands: Record<string, { id: string; displayName: string; pluginName: string }>
    propertyPanels: Record<string, Array<PropertyPanelContribution & { pluginName: string }>>
    inspectors: Record<string, { id: string; displayName: string; component: string; pluginName: string }>
  } {
    const result: {
      nodeViews: Record<string, NodeViewContribution>
      commands: Record<string, { id: string; displayName: string; pluginName: string }>
      propertyPanels: Record<string, Array<PropertyPanelContribution & { pluginName: string }>>
      inspectors: Record<string, { id: string; displayName: string; component: string; pluginName: string }>
    } = {
      nodeViews: {},
      commands: {},
      propertyPanels: {},
      inspectors: {},
    }

    for (const [pluginName, loaded] of this.plugins) {
      if (loaded.status !== 'loaded') continue

      for (const [type, contrib] of loaded.contributions.nodeViews) {
        result.nodeViews[type] = contrib
      }

      for (const [id, contrib] of loaded.contributions.commands) {
        result.commands[id] = {
          id: contrib.id,
          displayName: contrib.displayName,
          pluginName,
        }
      }

      for (const [nodeType, panels] of loaded.contributions.propertyPanels) {
        if (!result.propertyPanels[nodeType]) {
          result.propertyPanels[nodeType] = []
        }
        for (const panel of panels) {
          result.propertyPanels[nodeType].push({ ...panel, pluginName })
        }
      }

      for (const [id, contrib] of loaded.contributions.inspectors) {
        result.inspectors[id] = { ...contrib, pluginName }
      }
    }

    return result
  }

  /**
   * Return a list of all known plugins and their status.
   */
  list(): Array<{
    name: string
    displayName: string
    version: string
    status: PluginStatus
    reason?: string
    nodeTypes: string[]
    nodeViews: Record<string, string>
  }> {
    const result: Array<{
      name: string
      displayName: string
      version: string
      status: PluginStatus
      reason?: string
      nodeTypes: string[]
      nodeViews: Record<string, string>
    }> = []

    for (const [, loaded] of this.plugins) {
      const views: Record<string, string> = {}
      for (const [type, contrib] of loaded.contributions.nodeViews) {
        views[type] = contrib.component
      }
      result.push({
        name: loaded.manifest.name,
        displayName: loaded.manifest.displayName,
        version: loaded.manifest.version,
        status: loaded.status,
        reason: loaded.reason,
        nodeTypes: loaded.manifest.contributions?.nodeTypes || [],
        nodeViews: views,
      })
    }

    return result
  }

  // -------------------------------------------------------------------------
  // Bulk operations
  // -------------------------------------------------------------------------

  /**
   * Discover and load all plugins from the plugins directory.
   * Called at startup and after opening a world.
   */
  async discoverAndLoadAll(kernelBridge: any): Promise<void> {
    this.kernelBridge = kernelBridge
    const manifests = this.discoverPlugins()
    const discoveredNames = new Set(manifests.map((manifest) => manifest.name))

    for (const [name, loaded] of [...this.plugins]) {
      if (!discoveredNames.has(name) && loaded.status === 'loaded') {
        await this.unloadPlugin(name)
      }
    }

    for (const manifest of manifests) {
      // Skip if already loaded
      if (this.plugins.has(manifest.name) && this.plugins.get(manifest.name)!.status === 'loaded') {
        continue
      }
      await this.loadPlugin(manifest.name)
    }
  }

  // -------------------------------------------------------------------------
  // IPC registration
  // -------------------------------------------------------------------------

  /**
   * Register IPC handlers for plugin queries and lifecycle commands.
   */
  static registerHandlers(ipcMain: IpcMain, host: PluginHost): void {
    ipcMain.handle('plugin:list', () => {
      return host.list()
    })

    ipcMain.handle('plugin:getContributions', () => {
      return host.getContributions()
    })

    // Plugin names arrive from the renderer unvalidated; reject anything that
    // is not a single safe path segment before it reaches the filesystem.
    ipcMain.handle('plugin:reload', async (_event, name: unknown) => {
      if (!isValidPluginName(name)) return { status: 'failed', reason: 'Invalid plugin name' }
      return host.reloadPlugin(name)
    })

    ipcMain.handle('plugin:enable', async (_event, name: unknown) => {
      if (!isValidPluginName(name)) return { status: 'failed', reason: 'Invalid plugin name' }
      return host.enablePlugin(name)
    })

    ipcMain.handle('plugin:disable', async (_event, name: unknown) => {
      if (!isValidPluginName(name)) return { ok: false, error: 'Invalid plugin name' }
      await host.disablePlugin(name)
      return { ok: true }
    })

    // Execute a registered command by id
    ipcMain.handle('plugin:executeCommand', async (
      _event,
      commandId: string,
      args: Record<string, unknown>,
      selectedNodes: string[] = [],
    ) => {
      for (const [, loaded] of host.plugins) {
        if (loaded.status !== 'loaded') continue
        const cmd = loaded.contributions.commands.get(commandId)
        if (cmd) {
          try {
            const context = {
              kernel: {
                submit: (actorKind: string, actorId: string, message: string, ops: any[]) =>
                  host.kernelBridge.submit(actorKind, actorId, message, ops),
                getNodes: () => host.kernelBridge.getNodes(),
                getNode: (id: string) => host.kernelBridge.getNode(id),
                getEdges: () => host.kernelBridge.getEdges(),
                status: () => host.kernelBridge.status(),
              },
              selectedNodes: Array.isArray(selectedNodes) ? selectedNodes : [],
              arguments: args || {},
            }
            await cmd.handler(context)
            return { ok: true }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            // D-34: command handler crash triggers plugin crash handling
            const pluginName = loaded.manifest.name
            await host.handlePluginCrash(pluginName, errorMsg)
            return { ok: false, error: errorMsg }
          }
        }
      }
      return { ok: false, error: `Command ${commandId} not found` }
    })
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve a plugin name to its directory under pluginsDir, or null when the
   * name is not a single safe path segment or the resolved directory is not a
   * direct child of pluginsDir (defense in depth against traversal).
   */
  private resolvePluginDir(name: string): string | null {
    if (!isValidPluginName(name)) return null
    const dir = resolve(this.pluginsDir, name)
    const rel = relative(this.pluginsDir, dir)
    if (rel !== name || isAbsolute(rel) || rel.includes(sep)) return null
    return dir
  }

  private createEmptyRegistry(): ContributionRegistry {
    return {
      nodeViews: new Map(),
      commands: new Map(),
      propertyPanels: new Map(),
      inspectors: new Map(),
    }
  }
}
