/**
 * PluginSurfaceLayer -- the renderer half of CANV-04.
 *
 * A plugin registers a surface (SDK `SurfaceContribution`) and the host lists
 * it in `getContributions().surfaces`. Opening one mounts a floating window
 * over the canvas, which dynamically imports the plugin's ES module over the
 * privileged plugin scheme (tapestry-plugin) and calls the module's default
 * `mount(host)` with the window's content element.
 *
 * Every surface opens the same way: a window the person can move by its
 * title bar, resize from any edge or corner, maximize (button or double-click
 * on the title) and close. Several can be open at once beside the canvas, one
 * per surface; opening an open surface raises it. Window rects are view
 * state, remembered per surface id in localStorage and never sent to main,
 * so they never enter a tree or a hash. The geometry is layout/surface-windows.ts.
 *
 * The URL is assembled from registry data only: `pluginName` is the plugin's
 * directory id and `entry` is the host-validated, contained entry path
 * (T-04-01). Nothing here special-cases any plugin, path or module; the only
 * surface-specific input is what the registry returned.
 *
 * Layering: siblings of the canvas in App.tsx (never inside its transformed
 * container, so CSS pan/zoom never touches them), from zIndex 9000 up in
 * stacking order -- above the canvas, below PluginErrorNotification (10000)
 * so errors stay visible. Keys, presses, double-clicks and wheel scrolling
 * inside a window stay inside it, as in the chat panel, so typing in a
 * surface never deletes a note and scrolling never pans the space.
 *
 * Dispose contract: the module's `dispose()` is idempotent by SDK contract, so
 * the effect cleanup may call it under React 18 StrictMode's double invoke.
 * A `cancelled` flag covers the window between the awaited import/mount and
 * an unmount that raced ahead of it. A window keeps the tree it was opened
 * for, so selecting another tree never remounts a running surface.
 *
 * This file imports nothing from `three`, the SDK, or Electron: the SDK
 * surface types are mirrored in global.d.ts because tsconfig.web's rootDir
 * excludes sdk/src.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  TITLE_BAR_HEIGHT,
  clampWindows,
  moveRect,
  openWindow,
  raiseWindow,
  resizeRect,
  type OpenWindow,
  type ResizeEdge,
  type ViewportSize,
  type WindowRect,
} from '../layout/surface-windows'

/** What the renderer keeps of a registered surface (from getContributions). */
export interface SurfaceInfo {
  id: string
  displayName: string
  entry: string
  pluginName: string
}

export type SurfaceWindowState = OpenWindow<SurfaceInfo>

// ---------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------

/**
 * One "Open <displayName>" button per registered surface, in a fixed
 * top-right strip. Renders nothing when there is nothing to open.
 */
export function SurfaceLauncher({
  surfaces,
  onOpen,
}: {
  surfaces: SurfaceInfo[]
  onOpen: (surface: SurfaceInfo) => void
}): React.ReactElement | null {
  if (surfaces.length === 0) return null

  return (
    <div
      className="plugin-surface-launcher"
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        // Below notifications (10000) and below open surface windows (9000+)
        // so a window dragged over the strip covers it.
        zIndex: 8500,
        display: 'flex',
        gap: 8,
      }}
    >
      {surfaces.map((surface) => {
        const label = `Open ${surface.displayName}`
        return (
          <button
            key={surface.id}
            type="button"
            aria-label={label}
            onClick={() => onOpen(surface)}
            style={{
              background: 'var(--tap-surface)',
              border: '1px solid var(--tap-border)',
              borderRadius: 6,
              boxShadow: '0 2px 6px rgba(0,0,0,0.10)',
              padding: '6px 12px',
              fontSize: 13,
              color: 'var(--tap-ink)',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Window state
// ---------------------------------------------------------------------------

const RECTS_KEY = 'tapestry.surfaceWindows.v1'

function viewportSize(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** Remembered rects by surface id. Storage can be missing or throw; then none. */
function readRects(): Record<string, WindowRect> {
  try {
    const raw = window.localStorage.getItem(RECTS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, WindowRect>) : {}
  } catch {
    return {}
  }
}

function isRect(value: unknown): value is WindowRect {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]))
}

function rememberRect(surfaceId: string, rect: WindowRect): void {
  try {
    const rects = readRects()
    rects[surfaceId] = rect
    window.localStorage.setItem(RECTS_KEY, JSON.stringify(rects))
  } catch {
    // A convenience only: the window still works without it.
  }
}

export interface SurfaceWindowActions {
  open: (surface: SurfaceInfo, treeId: string) => void
  close: (surfaceId: string) => void
  raise: (surfaceId: string) => void
  setRect: (surfaceId: string, rect: WindowRect) => void
  toggleMaximized: (surfaceId: string) => void
}

/** The open surface windows and what can be done to them. Owned by App. */
export function useSurfaceWindows(): [SurfaceWindowState[], SurfaceWindowActions] {
  const [windows, setWindows] = useState<SurfaceWindowState[]>([])

  // A smaller app window pulls every surface window back on screen.
  useEffect(() => {
    const onResize = (): void => setWindows((ws) => (ws.length === 0 ? ws : clampWindows(ws, viewportSize())))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const open = useCallback((surface: SurfaceInfo, treeId: string) => {
    const stored = readRects()[surface.id]
    setWindows((ws) => openWindow(ws, surface, treeId, viewportSize(), isRect(stored) ? stored : null))
  }, [])

  const close = useCallback((surfaceId: string) => {
    setWindows((ws) => ws.filter((w) => w.surface.id !== surfaceId))
  }, [])

  const raise = useCallback((surfaceId: string) => {
    setWindows((ws) => raiseWindow(ws, surfaceId))
  }, [])

  const setRect = useCallback((surfaceId: string, rect: WindowRect) => {
    rememberRect(surfaceId, rect)
    setWindows((ws) => ws.map((w) => (w.surface.id === surfaceId ? { ...w, rect, maximized: false } : w)))
  }, [])

  const toggleMaximized = useCallback((surfaceId: string) => {
    setWindows((ws) => ws.map((w) => (w.surface.id === surfaceId ? { ...w, maximized: !w.maximized } : w)))
  }, [])

  return [windows, { open, close, raise, setRect, toggleMaximized }]
}

/** Every open surface window, bottom to top. */
export function SurfaceWindowStack({
  windows,
  actions,
}: {
  windows: SurfaceWindowState[]
  actions: SurfaceWindowActions
}): React.ReactElement {
  return (
    <>
      {windows.map((w, index) => (
        <SurfaceWindow
          key={w.surface.id}
          state={w}
          zIndex={9000 + index}
          isTop={index === windows.length - 1}
          actions={actions}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// One window
// ---------------------------------------------------------------------------

const RESIZE_EDGES: Array<{ edge: ResizeEdge; style: React.CSSProperties }> = [
  { edge: 'n', style: { top: -3, left: 8, right: 8, height: 6, cursor: 'ns-resize' } },
  { edge: 's', style: { bottom: -3, left: 8, right: 8, height: 6, cursor: 'ns-resize' } },
  { edge: 'e', style: { right: -3, top: 8, bottom: 8, width: 6, cursor: 'ew-resize' } },
  { edge: 'w', style: { left: -3, top: 8, bottom: 8, width: 6, cursor: 'ew-resize' } },
  { edge: 'ne', style: { top: -4, right: -4, width: 12, height: 12, cursor: 'nesw-resize' } },
  { edge: 'nw', style: { top: -4, left: -4, width: 12, height: 12, cursor: 'nwse-resize' } },
  { edge: 'se', style: { bottom: -4, right: -4, width: 14, height: 14, cursor: 'nwse-resize' } },
  { edge: 'sw', style: { bottom: -4, left: -4, width: 12, height: 12, cursor: 'nesw-resize' } },
]

/** The drag in progress: what it changes and where the pointer and rect began. */
type Drag = { kind: 'move' } | { kind: 'resize'; edge: ResizeEdge }

const headerButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--tap-console-border-strong)',
  borderRadius: 6,
  color: 'var(--tap-console-ink)',
  padding: '2px 10px',
  fontSize: 12,
  cursor: 'pointer',
}

function SurfaceWindow({
  state,
  zIndex,
  isTop,
  actions,
}: {
  state: SurfaceWindowState
  zIndex: number
  isTop: boolean
  actions: SurfaceWindowActions
}): React.ReactElement {
  const { surface, treeId, maximized } = state
  const windowRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<{ url: string; message: string } | null>(null)

  // The rect shown during a drag; committed (and remembered) on release.
  const [liveRect, setLiveRect] = useState<WindowRect | null>(null)
  const rect = liveRect ?? state.rect

  // Latest actions without re-running the mount effect when App re-renders.
  const actionsRef = useRef(actions)
  useEffect(() => {
    actionsRef.current = actions
  }, [actions])

  // Wheel scrolling inside the window never pans or zooms the canvas; the
  // canvas listens natively, so this has to be native too.
  useEffect(() => {
    const el = windowRef.current
    if (!el) return undefined
    const onWheel = (e: WheelEvent): void => e.stopPropagation()
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Import and mount the surface module; dispose on cleanup.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let handle: TapestrySurfaceHandle | null = null
    setError(null)

    // Registry data only (T-04-01): directory id + host-validated entry.
    const url = `tapestry-plugin://${surface.pluginName}/${surface.entry}`

    const host: TapestrySurfaceHost = {
      container,
      treeId,
      onResize(cb) {
        const report = (): void => {
          const r = container.getBoundingClientRect()
          cb(r.width, r.height, window.devicePixelRatio)
        }
        const observer = new ResizeObserver(() => report())
        observer.observe(container)
        report()
        return () => observer.disconnect()
      },
      close() {
        actionsRef.current.close(surface.id)
      },
    }

    ;(async () => {
      try {
        const mod = (await import(/* @vite-ignore */ url)) as { default: TapestrySurfaceModule }
        if (cancelled) return
        if (!mod.default || typeof mod.default.mount !== 'function') {
          throw new Error('module default export has no mount() function')
        }
        const mounted = await mod.default.mount(host)
        if (cancelled) {
          // Unmounted while mount() was pending: release immediately.
          mounted.dispose()
          return
        }
        handle = mounted
      } catch (err) {
        let message = err instanceof Error ? err.message : String(err)
        console.error(`[PluginSurfaceLayer] failed to mount ${url}:`, err)
        // A failed import does not say why. If the entry itself is absent it
        // is usually build output that was never made (a gitignored dist/),
        // so say that instead of leaving "failed to fetch" to be decoded.
        try {
          const probe = await fetch(url, { method: 'HEAD' })
          if (probe.status === 404) {
            message +=
              `\n\n${surface.entry} does not exist in plugin "${surface.pluginName}".` +
              `\nIf it is build output, the plugin surface was not built: run` +
              ` \`npm --prefix app run build:plugins\` and check its warnings.`
          }
        } catch {
          // Probe is best-effort; keep the original message.
        }
        if (!cancelled) setError({ url, message })
      }
    })()

    return () => {
      cancelled = true
      // dispose() is idempotent by contract (StrictMode double-invoke safe).
      handle?.dispose()
      handle = null
    }
  }, [surface.id, surface.pluginName, surface.entry, treeId])

  // Title-bar moves and edge resizes: pointer capture on the handle, the rect
  // recomputed from where the drag began so rounding never accumulates.
  const beginDrag = useCallback(
    (drag: Drag, e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || maximized) return
      e.preventDefault()
      const handleEl = e.currentTarget
      handleEl.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startY = e.clientY
      const start = state.rect
      let latest = start

      const onMove = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        const viewport = { width: window.innerWidth, height: window.innerHeight }
        latest = drag.kind === 'move' ? moveRect(start, dx, dy, viewport) : resizeRect(start, drag.edge, dx, dy, viewport)
        setLiveRect(latest)
      }
      const onEnd = (): void => {
        handleEl.removeEventListener('pointermove', onMove)
        handleEl.removeEventListener('pointerup', onEnd)
        handleEl.removeEventListener('pointercancel', onEnd)
        setLiveRect(null)
        if (latest !== start) actionsRef.current.setRect(surface.id, latest)
      }
      handleEl.addEventListener('pointermove', onMove)
      handleEl.addEventListener('pointerup', onEnd)
      handleEl.addEventListener('pointercancel', onEnd)
    },
    [maximized, state.rect, surface.id],
  )

  const placement: React.CSSProperties = maximized
    ? { left: 0, top: 0, width: '100vw', height: '100vh', borderRadius: 0 }
    : { left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderRadius: 8 }

  return (
    <div
      ref={windowRef}
      className="plugin-surface-window"
      role="dialog"
      aria-label={surface.displayName}
      tabIndex={-1}
      // Pressing anywhere raises the window and takes focus, so its keys come
      // here (and stop here) rather than going to the canvas.
      onPointerDownCapture={() => {
        if (!isTop) actions.raise(surface.id)
        if (!windowRef.current?.contains(document.activeElement)) windowRef.current?.focus({ preventScroll: true })
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        // Escape closes the window unless the surface used it.
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          actions.close(surface.id)
        }
      }}
      style={{
        position: 'fixed',
        ...placement,
        zIndex,
        background: 'var(--tap-console-bg)',
        color: 'var(--tap-console-ink)',
        border: '1px solid var(--tap-console-border)',
        boxShadow: isTop ? '0 12px 32px rgba(0,0,0,0.35)' : '0 6px 18px rgba(0,0,0,0.22)',
        outline: 'none',
        overflow: 'visible',
      }}
    >
      <div
        className="plugin-surface-window-header"
        onPointerDown={(e) => beginDrag({ kind: 'move' }, e)}
        onDoubleClick={() => actions.toggleMaximized(surface.id)}
        style={{
          height: TITLE_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '0 8px 0 12px',
          borderBottom: '1px solid var(--tap-console-border)',
          fontSize: 13,
          cursor: maximized ? 'default' : 'move',
          userSelect: 'none',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {surface.displayName}
        </span>
        <span style={{ display: 'flex', gap: 6 }} onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            aria-label={maximized ? `Restore ${surface.displayName}` : `Maximize ${surface.displayName}`}
            aria-pressed={maximized}
            onClick={() => actions.toggleMaximized(surface.id)}
            style={headerButtonStyle}
          >
            {maximized ? 'Restore' : 'Maximize'}
          </button>
          <button
            type="button"
            aria-label={`Close ${surface.displayName}`}
            onClick={() => actions.close(surface.id)}
            style={headerButtonStyle}
          >
            Close
          </button>
        </span>
      </div>

      {/* The plugin owns this element's children only. */}
      <div
        ref={containerRef}
        className="plugin-surface-container"
        style={{
          position: 'absolute',
          top: TITLE_BAR_HEIGHT,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: 'hidden',
          borderBottomLeftRadius: maximized ? 0 : 8,
          borderBottomRightRadius: maximized ? 0 : 8,
        }}
      />

      {/* While a drag is live, a shield keeps the surface's own canvas from
          swallowing the pointer as it crosses into the window. */}
      {liveRect && <div style={{ position: 'absolute', inset: 0, zIndex: 2 }} />}

      {!maximized &&
        RESIZE_EDGES.map(({ edge, style }) => (
          <div
            key={edge}
            className={`plugin-surface-window-resize plugin-surface-window-resize--${edge}`}
            aria-hidden="true"
            onPointerDown={(e) => beginDrag({ kind: 'resize', edge }, e)}
            style={{ position: 'absolute', zIndex: 3, ...style }}
          />
        ))}

      {error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: TITLE_BAR_HEIGHT + 12,
            left: 12,
            right: 12,
            zIndex: 1,
            background: 'var(--tap-console-error-bg)',
            border: '1px solid var(--tap-console-error-border)',
            borderRadius: 6,
            color: 'var(--tap-console-error-ink)',
            padding: '10px 12px',
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {`Failed to load surface ${surface.id}\n${error.url}\n${error.message}`}
        </div>
      )}
    </div>
  )
}
