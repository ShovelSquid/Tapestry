/**
 * The slice of the host renderer's `window.tapestry` the surface uses
 * (app/src/preload/index.ts). A surface runs in the host renderer's realm
 * and may read the kernel this way; it must never call `submit`, which
 * signs as the human (SDK SurfaceHost notes, D-06).
 */
export interface KernelNode {
  id: string
  type: string
  props: Record<string, { type: string; value: string | number | boolean }>
}

export interface TapestryRead {
  kernel: {
    getNodes(treeId: string): Promise<KernelNode[]>
  }
  onTreeChanged(cb: (treeId: string) => void): () => void
}

declare global {
  interface Window {
    tapestry?: TapestryRead
  }
}
