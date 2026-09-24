/**
 * worker-spawn.ts — spawn a module Worker whose script may live on another
 * origin than the document.
 *
 * Inside Tapestry the surface module is served from tapestry-plugin:// while
 * the document is http://localhost:5173 (dev) or file:// (built), and
 * Chromium requires a Worker's script URL to be same-origin with the
 * document — CORS cannot relax it (01-04, refuted RESEARCH A2; Kaelen chose
 * this trampoline). A blob: module created by the document is same-origin
 * with it, so a one-statement blob module that statically imports the
 * absolute worker URL is accepted; the real worker module and the .wasm it
 * references still load over the scheme with CORS, and the worker module's
 * own import.meta.url stays the scheme URL, so its relative asset resolution
 * is unchanged. On the plugin's own dev page the URL is same-origin anyway
 * and the trampoline is one extra hop.
 *
 * The blob URL is revoked on the worker's first message or error (the script
 * has been consumed by then) and by the returned revoke() from dispose.
 */
export interface SpawnedWorker {
  worker: Worker
  /** Idempotent; safe to call after the worker was terminated. */
  revoke(): void
}

export function spawnSameOriginModuleWorker(absoluteUrl: string, options: { name?: string } = {}): SpawnedWorker {
  const trampoline = new Blob([`import ${JSON.stringify(absoluteUrl)};`], { type: 'text/javascript' })
  let blobUrl: string | null = URL.createObjectURL(trampoline)
  const revoke = (): void => {
    if (blobUrl !== null) {
      URL.revokeObjectURL(blobUrl)
      blobUrl = null
    }
  }
  let worker: Worker
  try {
    worker = new Worker(blobUrl, { type: 'module', ...options })
  } catch (err) {
    revoke()
    throw err
  }
  worker.addEventListener('message', revoke, { once: true })
  worker.addEventListener('error', revoke, { once: true })
  return { worker, revoke }
}
