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

import { readdirSync, readFileSync, existsSync, realpathSync } from 'fs'
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

/**
 * A plugin found on disk. `dir` is the directory name under plugins/ and is
 * the plugin's identifier everywhere in the host (map key, IPC name, path
 * component); `manifest.name` is author-controlled metadata and is never
 * used as a path.
 */
interface DiscoveredPlugin {
  dir: string
  manifest: PluginManifest
}

/**
 * Validate and normalize a parsed manifest. Every field that is later used
 * as a path component or string is type-checked here so a malformed manifest
 * (e.g. `"main": 1`) is reported as a failed plugin instead of throwing a
 * TypeError out of the host (D-33: a broken plugin never prevents the world
 * from opening).
 */
function normalizeManifest(raw: unknown): { manifest: PluginManifest } | { reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { reason: 'manifest is not a JSON object' }
  }
  const m = raw as Record<string, unknown>
  if (typeof m.name !== 'string' || typeof m.version !== 'string' || typeof m.main !== 'string') {
    return { reason: 'manifest missing required string fields (name, version, main)' }
  }

  const rawContributions = m.contributions
  const contributions: PluginManifest['contributions'] =
    rawContributions && typeof rawContributions === 'object' && !Array.isArray(rawContributions)
      ? { ...(rawContributions as PluginManifest['contributions']) }
      : { nodeTypes: [] }
  if (!Array.isArray(contributions.nodeTypes)) contributions.nodeTypes = []

  let api = ''
  if (typeof m.api === 'string') api = m.api
  else if (typeof m.api === 'number') api = String(m.api)

  return {
    manifest: {
      name: m.name,
      version: m.version,
      displayName: typeof m.displayName === 'string' ? m.displayName : m.name,
      main: m.main,
      api,
      contributions,
    },
  }
}

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

  /**
   * Plugins the user has disabled (D-32/D-35). Authoritative for discovery:
   * discoverAndLoadAll never loads a name in this set, so a disabled plugin
   * stays disabled across world open/create within the session.
   */
  private disabled = new Set<string>()

  /**
   * Callback to notify the renderer of plugin errors (set by main process).
   * Carries both the plugin id (the name used for reload/enable/disable) and
   * the human-readable display name; the renderer must never send the
   * display name back as an identifier.
   */
  onPluginError:
    | ((pluginName: string, displayName: string, error: string, canRestart: boolean) => void)
    | null = null

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
  discoverPlugins(): DiscoveredPlugin[] {
    if (!existsSync(this.pluginsDir)) {
      return []
    }

    const discovered: DiscoveredPlugin[] = []
    // Sort so load order (and therefore contribution precedence) is
    // deterministic rather than filesystem-dependent.
    const entries = readdirSync(this.pluginsDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!isValidPluginName(entry.name)) {
        console.warn(`[PluginHost] Skipping ${entry.name}: directory name is not a valid plugin id`)
        continue
      }

      const manifestPath = join(this.pluginsDir, entry.name, 'tapestry.plugin.json')
      if (!existsSync(manifestPath)) continue

      try {
        const raw = readFileSync(manifestPath, 'utf-8')

        // Validate required fields and types (T-02-10: malformed manifest protection)
        const parsed = normalizeManifest(JSON.parse(raw))
        if ('reason' in parsed) {
          console.warn(`[PluginHost] Skipping ${entry.name}: ${parsed.reason}`)
          continue
        }

        discovered.push({ dir: entry.name, manifest: parsed.manifest })
      } catch (err) {
        // T-02-10: malformed manifest logged and skipped
        console.warn(`[PluginHost] Skipping ${entry.name}: invalid manifest JSON`, err)
      }
    }

    return discovered
  }

  // -------------------------------------------------------------------------
  // Load / Unload lifecycle
  // -------------------------------------------------------------------------

  /**
   * Load a single plugin by id (its directory name under plugins/). Validates
   * API version, loads the entry module, constructs a PluginContext, and
   * calls activate().
   *
   * Per D-34: errors during activate are caught; the plugin is marked failed.
   * Per PLUG-05: version mismatch prevents loading with a clear reason.
   * Per D-31: the KernelAPI has no journal-level methods.
   */
  async loadPlugin(name: string): Promise<PluginLoadResult> {
    if (!this.kernelBridge) {
      return { status: 'failed', reason: 'No kernel bridge available' }
    }

    // Never activate a plugin twice: the entry module is served from
    // require.cache, so a second activate() would run on the same module
    // object and the first instance's deactivate() would never be called
    // (leaking timers, subscriptions, listeners). Use reloadPlugin() to
    // deliberately restart a running plugin.
    const existing = this.plugins.get(name)
    if (existing?.status === 'loaded') {
      return { status: 'loaded' }
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
      const parsed = normalizeManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
      if ('reason' in parsed) {
        return { status: 'failed', reason: `Invalid manifest: ${parsed.reason}` }
      }
      manifest = parsed.manifest
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
      return this.recordFailure(name, manifest, 'Plugin entry path escapes plugin directory')
    }

    // The host loads plugins with Node's require(), which cannot parse
    // TypeScript. Refuse non-JS entries up front with an actionable reason
    // instead of a SyntaxError deep inside require().
    if (!/\.c?js$/.test(entryPath)) {
      return this.recordFailure(
        name,
        manifest,
        `Plugin entry must be a .js/.cjs file (got ${manifest.main}); build the plugin first`,
      )
    }

    try {
      // Load the plugin module
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(entryPath)
      const plugin = mod.default || mod

      const contributions = this.createEmptyRegistry()

      // Contribution collisions are rejected at registration time instead of
      // being resolved silently by map iteration order in getContributions().
      // Throwing here fails this plugin's activation with a reason naming the
      // owner; the first registrant (deterministic: discovery is sorted by
      // directory name) keeps the contribution.
      const findOwner = (
        kind: 'nodeViews' | 'commands' | 'inspectors',
        key: string,
      ): string | null => {
        for (const [otherId, other] of this.plugins) {
          if (otherId === name || other.status !== 'loaded') continue
          if (other.contributions[kind].has(key)) return otherId
        }
        return null
      }

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
          const owner = findOwner('nodeViews', contribution.nodeType)
          if (owner) {
            throw new Error(
              `Node view for ${contribution.nodeType} is already registered by plugin ${owner}`,
            )
          }
          contributions.nodeViews.set(contribution.nodeType, contribution)
        },
        registerCommand: (contribution: CommandContribution) => {
          const owner = findOwner('commands', contribution.id)
          if (owner) {
            throw new Error(`Command ${contribution.id} is already registered by plugin ${owner}`)
          }
          contributions.commands.set(contribution.id, contribution)
        },
        registerPropertyPanel: (contribution: PropertyPanelContribution) => {
          const existing = contributions.propertyPanels.get(contribution.nodeType) || []
          existing.push(contribution)
          contributions.propertyPanels.set(contribution.nodeType, existing)
        },
        registerInspector: (contribution: InspectorContribution) => {
          const owner = findOwner('inspectors', contribution.id)
          if (owner) {
            throw new Error(`Inspector ${contribution.id} is already registered by plugin ${owner}`)
          }
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

    // Clear the require cache so a reload gets fresh code. Evict every
    // module under the plugin directory, not just the entry: helpers the
    // entry require()s (./PropertyPanel, ./commands, ...) would otherwise
    // keep running stale code after an explicit reload (D-29).
    const pluginDir = this.resolvePluginDir(name)
    if (pluginDir) {
      // require.cache is keyed by real path; match both the logical and the
      // resolved directory so a symlinked plugins/ (or /tmp on macOS) works.
      const prefixes = new Set([pluginDir + sep])
      try {
        prefixes.add(realpathSync(pluginDir) + sep)
      } catch {
        // Directory may already be gone from disk.
      }
      for (const key of Object.keys(require.cache)) {
        for (const prefix of prefixes) {
          if (key.startsWith(prefix)) {
            delete require.cache[key]
            break
          }
        }
      }
      // Also evict the resolved entry path, which may live elsewhere under
      // the plugin dir (e.g. dist/) or have been symlinked.
      try {
        delete require.cache[require.resolve(resolve(pluginDir, loaded.manifest.main))]
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
    // An explicit reload is an explicit request to run the plugin
    this.disabled.delete(name)
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
    const wasLoaded = this.plugins.get(name)?.status === 'loaded'
    this.disabled.delete(name)
    // Enabling an already-running plugin restarts it (deactivate, then
    // activate) rather than activating it a second time.
    const result = wasLoaded ? await this.reloadPlugin(name) : await this.loadPlugin(name)

    // Record the enable event in the journal (D-32) — only when the plugin
    // actually transitioned to loaded, so the readable history never asserts
    // an enable that failed or that changed nothing.
    if (result.status === 'loaded' && !wasLoaded) {
      await this.recordEvent(`enabled plugin ${name}`, name)
    }

    return result
  }

  /**
   * Disable a plugin: unload it and record the event in the .tree journal.
   * Per D-32: disable is recorded as a journal event.
   * Per D-35: disabled plugin content remains readable through fallback.
   */
  async disablePlugin(name: string): Promise<void> {
    const existing = this.plugins.get(name)
    const wasLoaded = existing?.status === 'loaded'

    await this.unloadPlugin(name)
    this.disabled.add(name)

    // Keep the plugin visible in list() as 'disabled' rather than letting it
    // vanish (and be silently re-enabled by the next discovery pass).
    const manifest = existing?.manifest ?? this.readManifestFor(name)
    if (manifest) {
      this.plugins.set(name, {
        manifest,
        instance: null,
        status: 'disabled',
        reason: 'Disabled by user',
        contributions: this.createEmptyRegistry(),
      })
    }

    // Record the disable event in the journal (D-32) — only for a real
    // transition; disabling a plugin that was not running changes nothing.
    if (wasLoaded) {
      await this.recordEvent(`disabled plugin ${name}`, name)
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
      this.onPluginError(name, displayName, `${displayName} stopped working. Restarting...`, false)
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
        this.onPluginError(name, displayName, '', false) // signal: clear notification
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
          name,
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
    /** Plugin id — the directory name; use this for reload/enable/disable. */
    id: string
    /** Author-supplied manifest name (metadata; may differ from id). */
    name: string
    displayName: string
    version: string
    status: PluginStatus
    reason?: string
    nodeTypes: string[]
    nodeViews: Record<string, string>
  }> {
    const result: Array<{
      id: string
      name: string
      displayName: string
      version: string
      status: PluginStatus
      reason?: string
      nodeTypes: string[]
      nodeViews: Record<string, string>
    }> = []

    for (const [id, loaded] of this.plugins) {
      const views: Record<string, string> = {}
      for (const [type, contrib] of loaded.contributions.nodeViews) {
        views[type] = contrib.component
      }
      result.push({
        id,
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
    const discovered = this.discoverPlugins()
    const discoveredIds = new Set(discovered.map((plugin) => plugin.dir))

    for (const [name, loaded] of [...this.plugins]) {
      if (!discoveredIds.has(name) && loaded.status === 'loaded') {
        try {
          await this.unloadPlugin(name)
        } catch (err) {
          console.error(`[PluginHost] ${name} threw during unload`, err)
        }
      }
    }

    // D-33: isolate each plugin so one throwing load cannot abort the rest
    // (or the world open that triggered discovery).
    for (const { dir } of discovered) {
      // Skip if already loaded
      if (this.plugins.get(dir)?.status === 'loaded') {
        continue
      }
      // Skip plugins the user disabled (D-32/D-35); the disabled set is authoritative
      if (this.disabled.has(dir)) {
        continue
      }
      try {
        await this.loadPlugin(dir)
      } catch (err) {
        console.error(`[PluginHost] ${dir} threw during load`, err)
      }
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
            // Distinguish a command that legitimately failed (a kernel
            // rejection, invalid input) from a broken plugin. Only programming
            // errors escalate to D-34 crash handling (unload + restart);
            // everything else is returned to the caller as a command error.
            const isCrash =
              err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError
            if (isCrash) {
              const pluginName = loaded.manifest.name
              await host.handlePluginCrash(pluginName, errorMsg)
            }
            return { ok: false, error: errorMsg, crashed: isCrash }
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

  /**
   * Record a plugin lifecycle event in the .tree journal (D-32) through
   * kernel.submit with actor kind "system" and actor id "tapestry".
   */
  private async recordEvent(message: string, name: string): Promise<void> {
    if (!this.kernelBridge || !this.kernelBridge.isLoaded) return
    try {
      await this.kernelBridge.submit('system', 'tapestry', message, [])
    } catch (err) {
      console.error(`[PluginHost] Failed to record journal event for ${name}:`, err)
    }
  }

  /**
   * Read and normalize the manifest for a plugin directory, or null when the
   * plugin is unknown or its manifest is unusable.
   */
  private readManifestFor(name: string): PluginManifest | null {
    const pluginDir = this.resolvePluginDir(name)
    if (!pluginDir) return null
    const manifestPath = join(pluginDir, 'tapestry.plugin.json')
    if (!existsSync(manifestPath)) return null
    try {
      const parsed = normalizeManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
      return 'reason' in parsed ? null : parsed.manifest
    } catch {
      return null
    }
  }

  /**
   * Record a plugin as failed (so it stays visible in list() with a reason)
   * and return the matching load result.
   */
  private recordFailure(name: string, manifest: PluginManifest, reason: string): PluginLoadResult {
    console.warn(`[PluginHost] ${name}: ${reason}`)
    this.plugins.set(name, {
      manifest,
      instance: null,
      status: 'failed',
      reason,
      contributions: this.createEmptyRegistry(),
    })
    return { status: 'failed', reason }
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
