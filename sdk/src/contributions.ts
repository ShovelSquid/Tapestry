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
