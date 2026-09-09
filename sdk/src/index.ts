/**
 * @tapestry/sdk — Plugin contract types for the Tapestry spatial workspace.
 *
 * Every plugin, first-party and third-party alike, imports these types to
 * describe itself to the host. The kernel owns all durable state; plugins
 * propose changes through KernelAPI.submit() and read the world through
 * the query methods.
 *
 * The six value types (text, int, real, bool, ref, time) match the kernel's
 * typed property model exactly — a plugin composes all of its data from
 * these primitives, and the kernel never learns a seventh type from a plugin.
 */

// ---------------------------------------------------------------------------
// Value types — the six kernel primitives
// ---------------------------------------------------------------------------

/**
 * The value types the kernel stores on nodes and edges. Every property
 * written through a `setProperty` op carries one of these types, and the
 * .tree file encodes it with the lowercase name (text, int, real, bool,
 * ref, time).
 */
export enum ValueType {
  Text = 'text',
  Int = 'int',
  Real = 'real',
  Bool = 'bool',
  Ref = 'ref',
  Time = 'time',
}

// ---------------------------------------------------------------------------
// World query results
// ---------------------------------------------------------------------------

/** A node as returned by the kernel query methods. */
export interface NodeData {
  id: string;
  type: string;
  props: Record<string, { type: ValueType; value: string | number | boolean }>;
}

/** An edge as returned by the kernel query methods. */
export interface EdgeData {
  id: string;
  from: string;
  to: string;
  label: string;
  props: Record<string, { type: ValueType; value: string | number | boolean }>;
}

/** The result of a successful kernel submit. */
export interface CommitResult {
  seq: number;
  digest: string;
  nodeIds: string[];
  edgeIds: string[];
}

/** Journal status as reported by the kernel. */
export interface JournalStatus {
  kind: 'Ok' | 'TornTail' | 'Corrupt';
  offset: number;
  bytes: number;
  lastGoodSeq: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Operations — the verbs a plugin can submit
// ---------------------------------------------------------------------------

export interface CreateNodeOp {
  op: 'createNode';
  type: string;
  props?: Record<string, { type: ValueType; value: string | number | boolean }>;
}

export interface SetPropertyOp {
  op: 'setProperty';
  target: string;        // "n<k>" or "e<k>"
  key: string;
  type: ValueType;
  value: string | number | boolean;
}

export interface UnsetPropertyOp {
  op: 'unsetProperty';
  target: string;
  key: string;
}

export interface CreateEdgeOp {
  op: 'createEdge';
  from: string;          // "n<k>"
  to: string;            // "n<k>"
  label: string;
  props?: Record<string, { type: ValueType; value: string | number | boolean }>;
}

export interface DeleteNodeOp {
  op: 'deleteNode';
  id: string;
}

export interface DeleteEdgeOp {
  op: 'deleteEdge';
  id: string;
}

export interface AdvanceOp {
  op: 'advance';
  ticks: number;
}

export type Op =
  | CreateNodeOp
  | SetPropertyOp
  | UnsetPropertyOp
  | CreateEdgeOp
  | DeleteNodeOp
  | DeleteEdgeOp
  | AdvanceOp;

// ---------------------------------------------------------------------------
// Kernel API — the surface plugins use to read and mutate the world
// ---------------------------------------------------------------------------

/**
 * The kernel surface exposed to plugins. All durable mutations pass through
 * submit(), which constructs a Proposal, validates it, and either commits
 * the change atomically or rejects it without side effects.
 */
export interface KernelAPI {
  /** Submit a batch of operations as a single atomic commit. */
  submit(
    actorKind: string,
    actorId: string,
    message: string,
    ops: Op[],
  ): Promise<CommitResult>;

  /** Return all live nodes in the world. */
  getNodes(): Promise<NodeData[]>;

  /** Return a single node by id string (e.g. "n1"). */
  getNode(id: string): Promise<NodeData | null>;

  /** Return all live edges in the world. */
  getEdges(): Promise<EdgeData[]>;

  /** Return the journal status. */
  status(): Promise<JournalStatus>;
}

// ---------------------------------------------------------------------------
// Plugin context — what the host hands to activate()
// ---------------------------------------------------------------------------

/**
 * The context object passed to a plugin's activate() method. It provides
 * access to the kernel and host registration methods.
 */
export interface PluginContext {
  /** The kernel API for reading and mutating the world. */
  kernel: KernelAPI;

  /**
   * Register a component to render nodes of the given type. The component
   * string is a module-relative path that the host resolves and loads.
   */
  registerNodeView(nodeType: string, component: string): void;
}

// ---------------------------------------------------------------------------
// Plugin contract — the interface every plugin must implement
// ---------------------------------------------------------------------------

/**
 * The contract every Tapestry plugin implements. The host calls activate()
 * when the plugin is loaded and deactivate() before it is unloaded. Both
 * first-party and third-party plugins implement this same interface (D-27,
 * PLUG-02).
 */
export interface TapestryPlugin {
  /** Human-readable plugin name, matching the manifest. */
  name: string;

  /** Semver version string, matching the manifest. */
  version: string;

  /** Called when the plugin is loaded into a running world. */
  activate(context: PluginContext): void | Promise<void>;

  /** Called before the plugin is unloaded. Clean up handlers and subscriptions. */
  deactivate(): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Node schema — how a plugin describes a node type it provides
// ---------------------------------------------------------------------------

/**
 * Describes a node type that a plugin registers. The type string follows
 * the dotted-path/name@version format (e.g. "tapestry.core/note@1").
 */
export interface NodeSchema {
  /** The node type identifier in dotted-path/name@version format. */
  type: string;

  /** Human-readable display name for the UI. */
  displayName: string;

  /** Default properties and their value types for new nodes of this type. */
  defaultProperties: Record<string, ValueType>;
}

// ---------------------------------------------------------------------------
// Plugin manifest — the declarative description of a plugin package
// ---------------------------------------------------------------------------

/**
 * The manifest that lives in a plugin's package.json or a dedicated
 * tapestry.json file. It declares what the plugin provides so the host
 * can discover and load it without executing code (D-28, D-30).
 */
export interface PluginManifest {
  /** Package name. */
  name: string;

  /** Semver version string. */
  version: string;

  /** Human-readable display name. */
  displayName: string;

  /** Entry point module path relative to the plugin root. */
  main: string;

  /** The SDK API version this plugin targets (e.g. "0.1"). */
  api: string;

  /** What the plugin contributes to the host. */
  contributions: {
    /** Node type identifiers this plugin registers. */
    nodeTypes: string[];
    /** Command identifiers this plugin registers. */
    commands: string[];
  };
}
