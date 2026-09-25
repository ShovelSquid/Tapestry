/**
 * Surface windows — pure geometry for plugin surfaces shown as floating
 * windows over the canvas. No React, no DOM.
 *
 * Every plugin surface opens in a window the person can move, resize,
 * maximize and close, several at once beside the canvas. The window is
 * view state: its rect lives in the renderer (and in localStorage, per
 * surface id) and never reaches a tree, a commit or a hash.
 *
 * All values are CSS pixels in the app window's viewport. The rules:
 *  - a window is never smaller than MIN_WINDOW_WIDTH x MIN_WINDOW_HEIGHT
 *    (unless the viewport itself is smaller) and never larger than the viewport
 *  - its title bar stays reachable: the top edge is inside the viewport and at
 *    least GRAB_MARGIN of the bar stays on screen horizontally
 *  - the list order is the stacking order, last on top
 */

export interface WindowRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

/** Which edge or corner a resize drags: any combination of n/s with e/w. */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const MIN_WINDOW_WIDTH = 320
export const MIN_WINDOW_HEIGHT = 240

/** Height of the window's title bar (the drag handle). */
export const TITLE_BAR_HEIGHT = 36

/** How much of the title bar must stay on screen horizontally. */
export const GRAB_MARGIN = 96

/** How far each newly opened window steps from the previous default. */
export const CASCADE_STEP = 28

/** A default window's share of the viewport. */
const DEFAULT_SHARE = 0.7

/**
 * Keep a rect inside the rules above. The size is settled first, then the
 * position, so a window shrunk by a smaller viewport is also pulled back on
 * screen.
 */
export function clampRect(rect: WindowRect, viewport: ViewportSize): WindowRect {
  const minW = Math.min(MIN_WINDOW_WIDTH, viewport.width)
  const minH = Math.min(MIN_WINDOW_HEIGHT, viewport.height)
  const width = Math.min(Math.max(rect.width, minW), viewport.width)
  const height = Math.min(Math.max(rect.height, minH), viewport.height)

  // A window as wide (or tall) as the viewport can only sit flush with it.
  const grab = Math.min(GRAB_MARGIN, width)
  const x = width >= viewport.width ? 0 : Math.min(Math.max(rect.x, grab - width), viewport.width - grab)
  const y =
    height >= viewport.height ? 0 : Math.min(Math.max(rect.y, 0), Math.max(0, viewport.height - TITLE_BAR_HEIGHT))
  return { x, y, width, height }
}

/**
 * Where the `index`-th window opens when it has no remembered rect: centred at
 * DEFAULT_SHARE of the viewport, stepped down and right so windows opened one
 * after another do not sit exactly on top of each other.
 */
export function defaultRect(viewport: ViewportSize, index: number): WindowRect {
  const width = Math.round(viewport.width * DEFAULT_SHARE)
  const height = Math.round(viewport.height * DEFAULT_SHARE)
  const step = CASCADE_STEP * (index % 6)
  return clampRect(
    {
      x: Math.round((viewport.width - width) / 2) + step,
      y: Math.round((viewport.height - height) / 2) + step,
      width,
      height,
    },
    viewport,
  )
}

/** The rect after dragging the title bar by (dx, dy) from `start`. */
export function moveRect(start: WindowRect, dx: number, dy: number, viewport: ViewportSize): WindowRect {
  return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, viewport)
}

/**
 * The rect after dragging `edge` by (dx, dy) from `start`. The opposite edge
 * stays put: a west or north drag that would go below the minimum stops at
 * the minimum instead of pushing the window along.
 */
export function resizeRect(
  start: WindowRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  viewport: ViewportSize,
): WindowRect {
  const minW = Math.min(MIN_WINDOW_WIDTH, viewport.width)
  const minH = Math.min(MIN_WINDOW_HEIGHT, viewport.height)
  let { x, y, width, height } = start

  if (edge.includes('e')) {
    width = Math.min(Math.max(start.width + dx, minW), viewport.width - start.x)
  }
  if (edge.includes('s')) {
    height = Math.min(Math.max(start.height + dy, minH), viewport.height - start.y)
  }
  if (edge.includes('w')) {
    const right = start.x + start.width
    const left = Math.min(Math.max(start.x + dx, 0), right - minW)
    x = left
    width = right - left
  }
  if (edge.includes('n')) {
    const bottom = start.y + start.height
    const top = Math.min(Math.max(start.y + dy, 0), bottom - minH)
    y = top
    height = bottom - top
  }
  return clampRect({ x, y, width, height }, viewport)
}

// ---------------------------------------------------------------------------
// The open windows
// ---------------------------------------------------------------------------

/** One open window. `treeId` is the tree it was opened for, fixed for its life. */
export interface OpenWindow<S> {
  surface: S
  treeId: string
  rect: WindowRect
  maximized: boolean
}

/**
 * Open `surface`, or raise it when it is already open (one window per
 * surface: a surface module is mounted once). A new window uses the
 * remembered rect for its surface when there is one.
 */
export function openWindow<S extends { id: string }>(
  windows: ReadonlyArray<OpenWindow<S>>,
  surface: S,
  treeId: string,
  viewport: ViewportSize,
  remembered: WindowRect | null,
): Array<OpenWindow<S>> {
  if (windows.some((w) => w.surface.id === surface.id)) return raiseWindow(windows, surface.id)
  const rect = remembered ? clampRect(remembered, viewport) : defaultRect(viewport, windows.length)
  return [...windows, { surface, treeId, rect, maximized: false }]
}

/** Move a window to the top of the stack. Unchanged when it is already there. */
export function raiseWindow<S extends { id: string }>(
  windows: ReadonlyArray<OpenWindow<S>>,
  surfaceId: string,
): Array<OpenWindow<S>> {
  const index = windows.findIndex((w) => w.surface.id === surfaceId)
  if (index < 0 || index === windows.length - 1) return windows as Array<OpenWindow<S>>
  return [...windows.slice(0, index), ...windows.slice(index + 1), windows[index]]
}

/** Re-apply the rules to every window, for a viewport that changed size. */
export function clampWindows<S>(
  windows: ReadonlyArray<OpenWindow<S>>,
  viewport: ViewportSize,
): Array<OpenWindow<S>> {
  return windows.map((w) => ({ ...w, rect: clampRect(w.rect, viewport) }))
}
