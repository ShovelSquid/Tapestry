/**
 * The tapestry-plugin:// scheme (CANV-04): how a plugin's built surface
 * module, its module Workers and its .wasm reach the renderer.
 *
 * `tapestry-plugin://<plugin-id>/<path>` maps to `<pluginsDir>/<plugin-id>/<path>`
 * and nothing else. The plugin id is the directory name under plugins/ (the
 * same id PluginHost uses); standard-scheme hosts are lowercased by the URL
 * parser, so only lowercase ids can be addressed.
 *
 * Nothing in this module imports Electron: the resolver and the handler are
 * plain functions over `URL`, `Request` and `Response`, so they are unit
 * tested under Node and wired to `protocol.handle` / `net.fetch` in index.ts.
 *
 * Security (T-02-01, ASVS V4): every request path is untrusted. The resolver
 * validates the host, rejects `.`/`..`/empty segments after decoding, checks
 * `relative()` containment, then compares realpaths so a symlink inside the
 * plugin directory cannot point outside it. Any failure is `null`, never a
 * throw, and the handler answers 404.
 */

import { realpathSync, statSync } from 'fs'
import { extname, isAbsolute, relative, resolve, sep } from 'path'
import { pathToFileURL } from 'url'

/** The scheme name. Must match what index.ts registers before app ready. */
export const PLUGIN_SCHEME = 'tapestry-plugin'

/**
 * Privileges the scheme is registered with. `standard` gives it a real
 * origin (relative Worker and .wasm URLs resolve), `secure` keeps the surface
 * in a secure context, `supportFetchAPI` + `corsEnabled` let the renderer's
 * document import() cross-origin, `stream` streams file bodies. No
 * `bypassCSP`, no `allowServiceWorkers` (RESEARCH V14).
 */
export const SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true,
} as const

/**
 * The lowercase subset of PluginHost's PLUGIN_NAME_RE. A URL host is
 * lowercased by the parser, so an uppercase plugin directory is simply not
 * addressable over this scheme.
 */
export const SURFACE_HOST_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

const MIME_BY_EXTENSION: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.map': 'application/json',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

/** Content-Type for a served file, by extension; unknown types are opaque bytes. */
export function mimeForPath(p: string): string {
  return MIME_BY_EXTENSION[extname(p).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Resolve a tapestry-plugin:// URL to a file inside a plugin directory, or
 * null. Never throws: a malformed URL, a bad host, a traversal attempt, a
 * symlink escape or a missing file all answer null.
 */
export function resolvePluginFile(
  pluginsDir: string,
  rawUrl: string,
): { path: string; mime: string } | null {
  // Defense in depth: the renderer builds surface URLs from a registered
  // entry, which the host already forbids from containing "..", so a request
  // that spells out a dot segment (plain or percent-encoded) is not one the
  // app produced. Refuse it before the URL parser normalises it away.
  let decodedRaw: string
  try {
    decodedRaw = decodeURIComponent(rawUrl)
  } catch {
    return null
  }
  for (const segment of decodedRaw.split(/[/\\]/)) {
    if (segment === '.' || segment === '..') return null
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${PLUGIN_SCHEME}:`) return null

  // Plugin id: a single lowercase path segment that is a direct child of
  // pluginsDir (mirrors PluginHost.resolvePluginDir).
  const host = url.hostname
  if (!SURFACE_HOST_RE.test(host) || host.includes('..')) return null
  const dir = resolve(pluginsDir, host)
  const relDir = relative(pluginsDir, dir)
  if (relDir !== host || isAbsolute(relDir) || relDir.includes(sep)) return null

  // Path: decoded once, then every segment is checked so an encoded ".."
  // cannot slip past the URL parser's own normalisation.
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (pathname.includes('\0')) return null
  const segments = pathname.split('/').slice(1) // leading "/" yields an empty first segment
  if (segments.length === 0) return null
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (segment === '.' || segment === '..') return null
    if (segment === '' && i !== segments.length - 1) return null
    if (segment.includes('\\')) return null
  }
  if (segments[segments.length - 1] === '') return null

  const file = resolve(dir, ...segments)
  const relFile = relative(dir, file)
  if (relFile === '' || relFile.startsWith('..') || isAbsolute(relFile)) return null

  // Must exist as a regular file, and its real location must stay inside the
  // plugin directory's real location (symlink escape).
  try {
    if (!statSync(file).isFile()) return null
    const realDir = realpathSync(dir)
    const realFile = realpathSync(file)
    if (!realFile.startsWith(realDir + sep)) return null
  } catch {
    return null
  }

  return { path: file, mime: mimeForPath(file) }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  // The plugin dev loop rebuilds dist/ constantly; never let a stale module
  // be served from cache.
  'Cache-Control': 'no-store',
} as const

/**
 * Build the `protocol.handle` callback. `fetchFile` receives a `file://` URL
 * of the resolved path (in production `net.fetch`; in tests a fake).
 */
export function makePluginSchemeHandler(
  pluginsDir: string,
  deps: { fetchFile: (fileUrl: string) => Promise<Response> },
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD', ...CORS_HEADERS },
      })
    }

    const resolved = resolvePluginFile(pluginsDir, request.url)
    if (!resolved) {
      return new Response('Not found', { status: 404, headers: CORS_HEADERS })
    }

    const headers = { 'Content-Type': resolved.mime, ...CORS_HEADERS }
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers })
    }

    const file = await deps.fetchFile(pathToFileURL(resolved.path).href)
    if (!file.ok) {
      return new Response('Not found', { status: 404, headers: CORS_HEADERS })
    }
    return new Response(file.body, { status: 200, headers })
  }
}
