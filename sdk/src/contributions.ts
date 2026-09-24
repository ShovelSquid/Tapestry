/// <reference lib="dom" />
/**
 * @tapestry/sdk — Contribution types for the plugin registration surface.
 *
 * Plugins register capabilities with the host through typed contribution
 * objects. Each contribution type corresponds to a category of extension
 * point in the Tapestry application.
 *
 * Per D-27: contributions are visible, understandable primitives.
 * Per PLUG-02: the versioned public SDK defines schemas, commands,
 * property/UI contributions.
 */

// ---------------------------------------------------------------------------
// Node View Contribution
// ---------------------------------------------------------------------------

/**
 * Registers a React component to render nodes of a specific type.
 *
 * The component is registered by name and resolved at render time by the
 * host's renderer. The nodeType follows dotted-path/name@version format
 * (e.g. "tapestry.notes/note@1").
 */
export interface NodeViewContribution {
  /** Node type in dotted-path/name@version format. */
  nodeType: string

  /** Human-readable display name for this node type. */
  displayName: string

  /**
   * Name of the React component to render this node type.
   * Registered by name and resolved at render time.
   */
  component: string
}

// ---------------------------------------------------------------------------
// Command Contribution
// ---------------------------------------------------------------------------

/**
 * Context passed to a command handler when it is executed.
 */
export interface CommandContext {
  /** The kernel API for reading and mutating the world. */
  kernel: import('./index').KernelAPI

  /**
   * Who invoked this command, stamped by the host. Commits the command makes
   * are recorded as `plugin <pluginId>`.
   */
  readonly actor: { readonly kind: 'human' | 'plugin' | 'system'; readonly id: string }

  /** IDs of currently selected nodes (may be empty). */
  selectedNodes: string[]

  /** Arbitrary arguments passed to the command invocation. */
  arguments: Record<string, unknown>
}

/**
 * Registers a command that plugins can invoke or expose to the user.
 *
 * Commands must go through kernel.submit for durable effects (PLUG-06, D-31).
 * The id is namespaced (e.g. "notes.createNote").
 */
export interface CommandContribution {
  /** Namespaced command identifier (e.g. "notes.createNote"). */
  id: string

  /** Human-readable display name for the command. */
  displayName: string

  /** Handler function called when the command is executed. */
  handler: (context: CommandContext) => void | Promise<void>
}

// ---------------------------------------------------------------------------
// Property Panel Contribution
// ---------------------------------------------------------------------------

/**
 * Registers a panel component shown in the contextual inspector when a
 * node of the specified type is selected.
 */
export interface PropertyPanelContribution {
  /** Node type this panel applies to. Use "*" for all types. */
  nodeType: string

  /** Human-readable display name for the panel. */
  displayName: string

  /** Name of the React component to render the panel. */
  component: string
}

// ---------------------------------------------------------------------------
// Inspector Contribution
// ---------------------------------------------------------------------------

/**
 * Registers a general panel contribution not tied to a specific node type.
 * Shown in the inspector sidebar or tool area.
 */
export interface InspectorContribution {
  /** Unique identifier for this inspector panel. */
  id: string

  /** Human-readable display name for the panel. */
  displayName: string

  /** Name of the React component to render the panel. */
  component: string
}

// ---------------------------------------------------------------------------
// Surface Contribution
// ---------------------------------------------------------------------------

/**
 * Registers a renderer-side surface: an ES module the host loads into a
 * full-window stage layer and hands a container element.
 *
 * The module is the plugin's own code, served from the plugin's directory
 * over the `tapestry-plugin://<plugin-id>/<entry>` origin (the plugin id is
 * the directory name under plugins/, lowercased by the URL parser, so ids in
 * surface URLs are lowercase-only). The module never imports from the host
 * or from Electron; module Workers and `.wasm` it references resolve
 * relative to that same origin.
 *
 * Trust: the module runs in the host renderer's JS realm and can reach
 * `window.tapestry` directly. This is the same "policy, not a sandbox" trust
 * level a plugin's main-process entry already has; iframe isolation on the
 * same scheme is the recorded future path (CANV-04).
 */
export interface SurfaceContribution {
  /** Namespaced id (e.g. "datadrawing.canvas"). */
  id: string

  /** Human-readable display name shown where the surface can be opened. */
  displayName: string

  /**
   * ES module path relative to the plugin root (e.g. "surface/dist/surface.js").
   * Must be a built `.js`/`.mjs` file inside the plugin directory.
   */
  entry: string

  /** API version "1" supports exactly one placement: a full-window stage layer. */
  placement: 'stage'
}

/**
 * What the host hands the surface module at mount time (renderer side).
 *
 * API version "1" hands the surface no kernel access: the renderer's only
 * kernel route signs commits as the human, which a plugin must never do
 * (D-06). A plugin-signed route for surfaces is a later, additive change.
 */
export interface SurfaceHost {
  /**
   * Host-owned, absolutely sized element filling the stage layer. The plugin
   * owns its children and must remove them in `SurfaceHandle.dispose`.
   */
  readonly container: HTMLElement

  /** Identity of the tree the surface was opened for. */
  readonly treeId: string

  /**
   * Subscribe to size changes of `container`. Called with CSS pixel width and
   * height plus the device pixel ratio; returns an unsubscribe function.
   */
  onResize(cb: (width: number, height: number, dpr: number) => void): () => void

  /** Ask the host to unmount the surface (the host then calls dispose). */
  close(): void
}

/**
 * What `SurfaceModule.mount` returns. `dispose` must be idempotent: the host
 * may call it more than once (React StrictMode double-mounts in development).
 */
export interface SurfaceHandle {
  dispose(): void
}

/**
 * The shape of a surface entry module's default export.
 */
export interface SurfaceModule {
  mount(host: SurfaceHost): Promise<SurfaceHandle> | SurfaceHandle
}
