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
}

interface TapestryPluginsAPI {
  list(): Promise<
    Array<{
      name: string
      displayName: string
      version: string
      nodeTypes: string[]
      nodeViews: Record<string, string>
    }>
  >
}

interface TapestryDialogAPI {
  showSave(): Promise<{ canceled: boolean; filePath?: string }>
}

interface TapestryAPI {
  kernel: TapestryKernelAPI
  plugins: TapestryPluginsAPI
  dialog: TapestryDialogAPI
  onFileOpened(callback: (filePath: string) => void): void
}

interface Window {
  tapestry: TapestryAPI
}
