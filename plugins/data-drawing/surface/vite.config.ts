import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type Rollup } from 'vite'

/**
 * The surface is a self-contained Vite project: `index.html` + dev-host.ts is
 * the plugin's own dev loop (no native app build needed to try it), and
 * `vite build` in library mode emits dist/surface.js, the module-worker
 * chunk and mathspace.wasm as files with import.meta.url-relative references —
 * the shape the host later imports over its plugin scheme.
 */
const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * Library mode inlines every asset as a data URL no matter what
 * `assetsInlineLimit` says (Vite 5 asset plugin: `if (config.build.lib)
 * return true`). The .wasm must stay a file next to the worker chunk, so
 * this build-only plugin takes over `<name>.wasm?url`: it emits the bytes as
 * an asset and hands back a URL resolved against the importing chunk.
 * In dev the `?url` import is served as a file by Vite itself.
 */
const WASM_FILE_QUERY = '?dd-wasm-file'

function wasmAsFile(): Plugin {
  // One emitted asset per .wasm path, shared by the `?url` import and the
  // Emscripten glue's own `new URL("<name>.wasm", import.meta.url)` fallback
  // (which Vite would otherwise inline as a second, dead, base64 copy).
  const refs = new Map<string, string>()
  const emit = (ctx: Rollup.PluginContext, file: string): string => {
    let ref = refs.get(file)
    if (ref === undefined) {
      ref = ctx.emitFile({ type: 'asset', name: basename(file), source: readFileSync(file) })
      refs.set(file, ref)
    }
    return ref
  }
  return {
    name: 'dd-wasm-as-file',
    enforce: 'pre',
    apply: 'build',
    async resolveId(source, importer) {
      if (importer === undefined || !source.endsWith('.wasm?url')) return null
      const resolved = await this.resolve(source.slice(0, -'?url'.length), importer, { skipSelf: true })
      return resolved === null ? null : resolved.id + WASM_FILE_QUERY
    },
    load(id) {
      if (!id.endsWith(WASM_FILE_QUERY)) return null
      const file = id.slice(0, -WASM_FILE_QUERY.length)
      return `export default import.meta.ROLLUP_FILE_URL_${emit(this, file)}`
    },
    transform(code, id) {
      if (!/\/wasm\/[a-z]+\.mjs$/.test(id)) return null
      const wasm = id.slice(0, -'.mjs'.length) + '.wasm'
      const pattern = new RegExp(`new URL\\(\\s*["']${basename(wasm)}["']\\s*,\\s*import\\.meta\\.url\\s*\\)\\.href`, 'g')
      if (!pattern.test(code)) return null
      const ref = emit(this, wasm)
      return { code: code.replace(pattern, `import.meta.ROLLUP_FILE_URL_${ref}`), map: null }
    },
  }
}

export default defineConfig({
  root,
  // Relative base: with the default '/' the worker chunk is referenced as
  // "/assets/sim.worker-*.js", which under tapestry-plugin://data-drawing/
  // resolves to the plugin root instead of surface/dist/. './' makes every
  // emitted reference resolve against the importing module's own URL.
  base: './',
  plugins: [wasmAsFile()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
      formats: ['es'],
      // A function pins the exact name: the host's entry check wants `.js`,
      // and Vite would otherwise pick `.mjs` for a package without "type": "module".
      fileName: () => 'surface.js',
    },
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
  },
  worker: {
    format: 'es',
    // config.plugins only reaches workers in dev; the build needs them here.
    plugins: () => [wasmAsFile()],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
