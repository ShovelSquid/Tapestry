/**
 * tapestry-plugin:// containment and MIME (CANV-04, T-02-01).
 *
 * The resolver is the whole access-control story for the scheme: whatever it
 * returns is served to the renderer. These tests build a real plugins/ tree
 * in a temp directory — with a file outside it and a symlink pointing there —
 * and assert that only files inside a valid plugin directory resolve.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { makeTempDir } from '../../test/helpers/temp-tree'
import {
  PLUGIN_SCHEME,
  SCHEME_PRIVILEGES,
  makePluginSchemeHandler,
  mimeForPath,
  resolvePluginFile,
} from './plugin-scheme'

let root: string
let pluginsDir: string

beforeAll(() => {
  root = makeTempDir('scheme')
  pluginsDir = join(root, 'plugins')
  mkdirSync(join(pluginsDir, 'demo', 'surface'), { recursive: true })
  writeFileSync(join(pluginsDir, 'demo', 'surface', 'a.js'), 'export default 1\n')
  writeFileSync(join(pluginsDir, 'demo', 'surface', 'w.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]))
  writeFileSync(join(pluginsDir, 'demo', 'secret.json'), '{"secret":true}\n')
  writeFileSync(join(root, 'outside.txt'), 'outside\n')
  symlinkSync(join(root, 'outside.txt'), join(pluginsDir, 'demo', 'link.js'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('SCHEME_PRIVILEGES', () => {
  it('is a standard, secure, CORS-enabled scheme without bypassCSP', () => {
    expect(PLUGIN_SCHEME).toBe('tapestry-plugin')
    expect(SCHEME_PRIVILEGES).toEqual({
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    })
    expect('bypassCSP' in SCHEME_PRIVILEGES).toBe(false)
    expect('allowServiceWorkers' in SCHEME_PRIVILEGES).toBe(false)
  })
})

describe('mimeForPath', () => {
  it('maps the extensions a surface ships', () => {
    expect(mimeForPath('x/surface.js')).toBe('text/javascript')
    expect(mimeForPath('x/chunk.mjs')).toBe('text/javascript')
    expect(mimeForPath('x/ddsim.wasm')).toBe('application/wasm')
    expect(mimeForPath('x/surface.js.map')).toBe('application/json')
    expect(mimeForPath('x/manifest.json')).toBe('application/json')
    expect(mimeForPath('x/style.css')).toBe('text/css')
    expect(mimeForPath('x/index.html')).toBe('text/html')
    expect(mimeForPath('x/icon.svg')).toBe('image/svg+xml')
    expect(mimeForPath('x/icon.png')).toBe('image/png')
    expect(mimeForPath('x/blob.bin')).toBe('application/octet-stream')
  })
})

describe('resolvePluginFile', () => {
  it('resolves a .js file inside the plugin with text/javascript', () => {
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/surface/a.js')).toEqual({
      path: resolve(pluginsDir, 'demo', 'surface', 'a.js'),
      mime: 'text/javascript',
    })
  })

  it('resolves a .wasm file with application/wasm', () => {
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/surface/w.wasm')).toEqual({
      path: resolve(pluginsDir, 'demo', 'surface', 'w.wasm'),
      mime: 'application/wasm',
    })
  })

  it('rejects .. traversal inside the path', () => {
    expect(
      resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/surface/../../secret.json'),
    ).toBeNull()
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/../outside.txt')).toBeNull()
  })

  it('rejects encoded traversal (%2e%2e)', () => {
    expect(
      resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/surface/%2e%2e/%2e%2e/secret.json'),
    ).toBeNull()
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/%2e%2e/outside.txt')).toBeNull()
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/surface%2f..%2f..%2fsecret.json')).toBeNull()
  })

  it('rejects an uppercase host (standard-scheme hosts are lowercase)', () => {
    // A directory named "Demo" does not exist; and even a matching one could
    // not be addressed, because the URL parser lowercases the host.
    mkdirSync(join(pluginsDir, 'Demo'), { recursive: true })
    writeFileSync(join(pluginsDir, 'Demo', 'a.js'), '')
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://Demo/a.js')).toBeNull()
  })

  it('rejects a symlink that escapes the plugin directory', () => {
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/link.js')).toBeNull()
  })

  it('rejects an unknown plugin', () => {
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://nope/surface/a.js')).toBeNull()
  })

  it('rejects a missing file and a directory', () => {
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/surface/missing.js')).toBeNull()
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/surface')).toBeNull()
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/surface/')).toBeNull()
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/')).toBeNull()
  })

  it('rejects other schemes and malformed URLs', () => {
    expect(resolvePluginFile(pluginsDir, 'http://demo/surface/a.js')).toBeNull()
    expect(resolvePluginFile(pluginsDir, 'file:///etc/passwd')).toBeNull()
    expect(resolvePluginFile(pluginsDir, 'not a url')).toBeNull()
    expect(resolvePluginFile(pluginsDir, '')).toBeNull()
  })

  it('rejects hosts that are not a single safe segment', () => {
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://../surface/a.js')).toBeNull()
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://.hidden/a.js')).toBeNull()
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin:///surface/a.js')).toBeNull()
  })

  it('never throws on a NUL byte or bad percent-encoding', () => {
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/surface/a.js%00')).toBeNull()
    expect(resolvePluginFile(pluginsDir, 'tapestry-plugin://demo/surface/a%zz.js')).toBeNull()
  })
})

describe('makePluginSchemeHandler', () => {
  function fakeFetch(): { calls: string[]; fetchFile: (u: string) => Promise<Response> } {
    const calls: string[] = []
    return {
      calls,
      fetchFile: async (u: string) => {
        calls.push(u)
        return new Response(readFileSync(fileURLToPath(u)), {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      },
    }
  }

  it('answers 404 with CORS for anything the resolver rejects', async () => {
    const fake = fakeFetch()
    const handler = makePluginSchemeHandler(pluginsDir, fake)
    const res = await handler(new Request('tapestry-plugin://demo/../outside.txt'))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('Not found')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(fake.calls).toEqual([])
  })

  it('answers 405 for POST', async () => {
    const fake = fakeFetch()
    const handler = makePluginSchemeHandler(pluginsDir, fake)
    const res = await handler(new Request('tapestry-plugin://demo/surface/a.js', { method: 'POST' }))
    expect(res.status).toBe(405)
    expect(fake.calls).toEqual([])
  })

  it('serves a valid file with MIME, CORS and no-store, fetched by file:// URL', async () => {
    const fake = fakeFetch()
    const handler = makePluginSchemeHandler(pluginsDir, fake)
    const res = await handler(new Request('tapestry-plugin://demo/surface/a.js'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/javascript')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.text()).toBe('export default 1\n')
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].startsWith('file://')).toBe(true)
    expect(fileURLToPath(fake.calls[0])).toBe(resolve(pluginsDir, 'demo', 'surface', 'a.js'))
  })

  it('answers HEAD with headers and no body', async () => {
    const fake = fakeFetch()
    const handler = makePluginSchemeHandler(pluginsDir, fake)
    const res = await handler(new Request('tapestry-plugin://demo/surface/w.wasm', { method: 'HEAD' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/wasm')
    expect(await res.text()).toBe('')
    expect(fake.calls).toEqual([])
  })
})
