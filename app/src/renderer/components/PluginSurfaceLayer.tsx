/**
 * PluginSurfaceLayer -- the renderer half of CANV-04.
 *
 * A plugin registers a surface (SDK `SurfaceContribution`) and the host lists
 * it in `getContributions().surfaces`. Opening one mounts this full-window
 * layer, which dynamically imports the plugin's ES module over the privileged
 * plugin scheme (tapestry-plugin) and calls the module's default `mount(host)`.
 *
 * The URL is assembled from registry data only: `pluginName` is the plugin's
 * directory id and `entry` is the host-validated, contained entry path
 * (T-04-01). Nothing here special-cases any plugin, path or module; the only
 * surface-specific input is what the registry returned.
 *
 * Layering: a sibling of the canvas in App.tsx (never inside its transformed
 * container, so CSS pan/zoom never touches it), zIndex 9000 -- above the
 * canvas, below PluginErrorNotification (10000) so errors stay visible.
 *
 * Dispose contract: the module's `dispose()` is idempotent by SDK contract, so
 * the effect cleanup may call it under React 18 StrictMode's double invoke.
 * A `cancelled` flag covers the window between the awaited import/mount and
 * an unmount that raced ahead of it.
 *
 * This file imports nothing from `three`, the SDK, or Electron: the SDK
 * surface types are mirrored in global.d.ts because tsconfig.web's rootDir
 * excludes sdk/src.
 */

import React, { useEffect, useRef, useState } from 'react'

/** What the renderer keeps of a registered surface (from getContributions). */
export interface SurfaceInfo {
  id: string
  displayName: string
  entry: string
  pluginName: string
}

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
        // Below notifications (10000) and below an open surface layer (9000)
        // so a mounted surface covers its own launcher.
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
              background: '#FFFFFF',
              border: '1px solid #E0DDD7',
              borderRadius: 6,
              boxShadow: '0 2px 6px rgba(0,0,0,0.10)',
              padding: '6px 12px',
              fontSize: 13,
              color: '#2C2C2C',
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
// Layer
// ---------------------------------------------------------------------------

const HEADER_HEIGHT = 40

/**
 * Full-window stage layer hosting one plugin surface. Mounted while a surface
 * is open; unmounting (Close button, Escape, or the plugin's own
 * `host.close()`) disposes the surface.
 */
export default function PluginSurfaceLayer({
  surface,
  treeId,
  onClose,
}: {
  surface: SurfaceInfo
  treeId: string
  onClose: () => void
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<{ url: string; message: string } | null>(null)

  // Latest onClose without re-running the mount effect when App re-renders.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Escape closes the layer.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
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
          const rect = container.getBoundingClientRect()
          cb(rect.width, rect.height, window.devicePixelRatio)
        }
        const observer = new ResizeObserver(() => report())
        observer.observe(container)
        report()
        return () => observer.disconnect()
      },
      close() {
        onCloseRef.current()
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
  }, [surface.pluginName, surface.entry, treeId])

  return (
    <div
      className="plugin-surface-layer"
      role="dialog"
      aria-label={surface.displayName}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: '#1E1E1E',
        color: '#F0EDE6',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className="plugin-surface-layer-header"
        style={{
          height: HEADER_HEIGHT,
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          borderBottom: '1px solid #3A3A3A',
          fontSize: 14,
        }}
      >
        <span>{surface.displayName}</span>
        <button
          type="button"
          aria-label={`Close ${surface.displayName}`}
          onClick={() => onCloseRef.current()}
          style={{
            background: 'transparent',
            border: '1px solid #5A5A5A',
            borderRadius: 6,
            color: '#F0EDE6',
            padding: '4px 10px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>

      {/* The plugin owns this element's children only. */}
      <div
        ref={containerRef}
        className="plugin-surface-container"
        style={{
          position: 'absolute',
          top: HEADER_HEIGHT,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: 'hidden',
        }}
      />

      {error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: HEADER_HEIGHT + 12,
            left: 12,
            right: 12,
            zIndex: 1,
            background: '#3B1212',
            border: '1px solid #A33',
            borderRadius: 6,
            color: '#FFD6D6',
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
