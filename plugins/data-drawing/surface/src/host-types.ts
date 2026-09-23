/**
 * host-types.ts — a structural stand-in for the SDK's SurfaceHost.
 *
 * 01-02 defines `SurfaceHost` in @tapestry/sdk; 01-06 switches this import
 * to it. Until then the surface is mounted by dev-host.ts with this shape.
 */
export interface SurfaceHostLike {
  /** The element the surface renders into; sized by the host. */
  readonly container: HTMLElement
  /** The world this surface paints in ('dev' on the dev page). */
  readonly treeId: string
  /** Called after the container's size changes. Returns an unsubscribe. */
  onResize(cb: (width: number, height: number) => void): () => void
  /** Ask the host to close this surface. */
  close(): void
}
