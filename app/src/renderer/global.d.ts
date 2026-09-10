/**
 * Ambient type declarations for the renderer process.
 * The tapestry API is exposed via contextBridge in the preload script.
 */

interface TapestryKernelAPI {
  create(path: string, worldName: string): Promise<{ ok: boolean }>
  open(path: string): Promise<{ ok: boolean }>
  submit(
    actorKind: string,
    actorId: string,
    message: string,
    ops: any[],
  ): Promise<{
    seq: number
    digest: string
    nodeIds: string[]
    edgeIds: string[]
  }>
  getNodes(): Promise<
    Array<{
      id: string
      type: string
      props: Record<string, { type: string; value: string | number | boolean }>
    }>
  >
  getNode(
    id: string,
  ): Promise<{
    id: string
    type: string
    props: Record<string, { type: string; value: string | number | boolean }>
  } | null>
  getEdges(): Promise<any[]>
  status(): Promise<any>
  getFilePath(): Promise<string | null>
  undo(): Promise<{ ok: boolean }>
  redo(): Promise<{ ok: boolean }>
}

interface TapestryPluginsAPI {
  list(): Promise<
    Array<{
      /** Plugin id (directory name) — use for reload/enable/disable. */
      id: string
      /** Author-supplied manifest name (metadata). */
      name: string
      displayName: string
      version: string
      status: string
      reason?: string
      nodeTypes: string[]
      nodeViews: Record<string, string>
    }>
  >
  getContributions(): Promise<{
    nodeViews: Record<string, { nodeType: string; displayName: string; component: string }>
    commands: Record<string, { id: string; displayName: string; pluginName: string }>
    propertyPanels: Record<string, Array<{ nodeType: string; displayName: string; component: string; pluginName: string }>>
    inspectors: Record<string, { id: string; displayName: string; component: string; pluginName: string }>
  }>
  reload(name: string): Promise<{ status: string; reason?: string }>
  enable(name: string): Promise<{ status: string; reason?: string }>
  disable(name: string): Promise<{ ok: boolean }>
  executeCommand(
    commandId: string,
    args?: Record<string, unknown>,
    selectedNodes?: string[],
  ): Promise<{ ok: boolean; error?: string; crashed?: boolean }>
}

interface TapestryDialogAPI {
  showSave(): Promise<{ canceled: boolean; filePath?: string }>
}

interface TapestryAPI {
  kernel: TapestryKernelAPI
  plugins: TapestryPluginsAPI
  dialog: TapestryDialogAPI
  onFileOpened(callback: (filePath: string) => void): () => void
  onPluginError(
    callback: (pluginName: string, displayName: string, message: string, canRestart: boolean) => void,
  ): () => void
}

interface Window {
  tapestry: TapestryAPI
}
