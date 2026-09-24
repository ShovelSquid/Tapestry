/**
 * The stage's single `WebGLRenderer` (RESEARCH Pattern 4; spike 001
 * thread.js:56-62 renderer creation).
 *
 * "One renderer, created lazily when the first thread overlay opens and
 * reused afterwards" -- Chromium caps the number of live WebGL contexts a
 * page may hold, so a renderer-per-overlay design runs out after a handful
 * of open/close cycles. This module owns exactly one `THREE.WebGLRenderer`
 * for the whole app: the first `getStageRenderer()` call creates it, every
 * later call (from any later thread overlay open) returns the same
 * instance, and the canvas is only ever attached to and detached from a
 * container -- never disposed while the app is running.
 *
 * `webglcontextlost`/`webglcontextrestored` are exposed as subscriptions
 * rather than handled here, because rebuilding buffers is a `Ribbon`/
 * `GlyphLayer` concern: those buffers must be rebuilt from the thread's own
 * records, never from whatever happened to be on screen at the moment the
 * context was lost (RESEARCH Pitfall 6 / the threat register's
 * T-02.3-04-03).
 */

import * as THREE from 'three'

export interface StageRendererHandle {
  readonly renderer: THREE.WebGLRenderer
  readonly domElement: HTMLCanvasElement
  /** Moves the renderer's canvas into `container`, detaching it from
   * wherever it was mounted before (a previous overlay, or nowhere). */
  attach(container: HTMLElement): void
  /** Stops the render loop (`setAnimationLoop(null)`) and removes the
   * canvas from its container, but does not dispose the renderer or lose
   * its GL context -- the next `getStageRenderer()` call reuses it. */
  detach(): void
  setAnimationLoop(callback: ((time: number) => void) | null): void
  /** Registers a `webglcontextlost` handler; returns an unsubscribe. The
   * default browser behavior (losing the context permanently) is already
   * prevented here via `event.preventDefault()`, so a caller only needs to
   * rebuild its own buffers when this fires. */
  onContextLost(callback: () => void): () => void
  /** Registers a `webglcontextrestored` handler; returns an unsubscribe. */
  onContextRestored(callback: () => void): () => void
  resize(width: number, height: number, pixelRatio: number): void
}

let handle: StageRendererHandle | null = null
let unavailable = false

function createHandle(): StageRendererHandle | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  } catch {
    return null
  }
  if (!renderer.getContext()) return null

  const canvas = renderer.domElement
  const lostCallbacks = new Set<() => void>()
  const restoredCallbacks = new Set<() => void>()

  // Losing the context is not fatal: preventDefault() keeps the browser
  // from tearing the context down permanently, so `webglcontextrestored`
  // can fire once the driver recovers (T-02.3-04-03).
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    renderer.setAnimationLoop(null)
    for (const callback of lostCallbacks) callback()
  })
  canvas.addEventListener('webglcontextrestored', () => {
    for (const callback of restoredCallbacks) callback()
  })

  return {
    renderer,
    domElement: canvas,
    attach(container) {
      if (canvas.parentElement !== container) {
        container.appendChild(canvas)
      }
    },
    detach() {
      renderer.setAnimationLoop(null)
      if (canvas.parentElement) canvas.parentElement.removeChild(canvas)
    },
    setAnimationLoop(callback) {
      renderer.setAnimationLoop(callback)
    },
    onContextLost(callback) {
      lostCallbacks.add(callback)
      return () => lostCallbacks.delete(callback)
    },
    onContextRestored(callback) {
      restoredCallbacks.add(callback)
      return () => restoredCallbacks.delete(callback)
    },
    resize(width, height, pixelRatio) {
      renderer.setPixelRatio(pixelRatio)
      // `updateStyle=false`: this canvas is shared across every overlay
      // open and its container isn't a Vite-managed root, so three.js must
      // not touch inline styles it doesn't own. But that also means WE must
      // set the canvas's CSS size ourselves -- otherwise the canvas keeps
      // whatever CSS size it last had (often none at all), while its
      // drawing-buffer resolution is `width * pixelRatio` px. On a DPR>1
      // display that mismatch doesn't just blur the image: an unstyled
      // canvas displays at its buffer's raw pixel dimensions, so at DPR 2 it
      // renders at literally twice the intended width and height, and only
      // the top-left quadrant of the scene ever falls inside the visible
      // container -- everything else (including whatever should have been
      // centred) is pushed off past the container's own edge.
      renderer.setSize(width, height, false)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    },
  }
}

/**
 * Returns the app's single stage `WebGLRenderer`, creating it lazily on the
 * first call. Returns `null` when WebGL is unavailable (no throw): the
 * caller falls back to `StageFallbackPanel` and never retries a context
 * creation that already failed once this session.
 */
export function getStageRenderer(): StageRendererHandle | null {
  if (unavailable) return null
  if (!handle) {
    handle = createHandle()
    if (!handle) unavailable = true
  }
  return handle
}

/** True once WebGL has been confirmed available this session (does not
 * create the renderer if it has not been requested yet). */
export function isWebglAvailable(): boolean {
  if (unavailable) return false
  return getStageRenderer() !== null
}
