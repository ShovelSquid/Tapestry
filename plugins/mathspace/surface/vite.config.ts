import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type Rollup } from 'vite'

/**
 * The stage surface is a self-contained Vite project, the shape of
 * data-drawing's: `vite build` in library mode emits dist/surface.js plus
 * mathspace.wasm as a file with an import.meta.url-relative reference,
 * which the host imports over `tapestry-plugin://mathspace/surface/dist/
 * surface.js`; `index.html` + dev-host.ts is the plugin's own dev loop (a
 * stub `window.tapestry` with a fixture world, no app build needed) and
 * mounts that same dist/surface.js.
 *
 * The plugin's own CommonJS files (image.js, world.js, projection.js,
 * engine-core.js) are bundled in: Vite only runs its CommonJS transform on
 * node_modules by default, so `commonjsOptions.include` names them too.
 * engine.js (the Node loader) is never imported here.
 */
const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * Library mode inlines every asset as a data URL no matter what
 * `assetsInlineLimit` says. The .wasm must stay a file next to surface.js,
 * so this build-only plugin rewrites the Emscripten glue's
 * `new URL("mathspace.wasm", import.meta.url).href` to an emitted asset.
 */
function wasmAsFile(): Plugin {
  let ref: string | undefined
  return {
    name: 'ms-wasm-as-file',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      if (!id.endsWith('/mathspace.mjs')) return null
      const wasm = id.slice(0, -'.mjs'.length) + '.wasm'
      const pattern = /new URL\(\s*["']mathspace\.wasm["']\s*,\s*import\.meta\.url\s*\)\.href/g
      if (!pattern.test(code)) return null
      if (ref === undefined) {
        ref = this.emitFile({ type: 'asset', name: basename(wasm), source: readFileSync(wasm) })
      }
      return { code: code.replace(pattern, `import.meta.ROLLUP_FILE_URL_${ref}`), map: null }
    },
  }
}

export default defineConfig({
  root,
  // Relative base: every emitted reference resolves against surface.js's
  // own URL, which under tapestry-plugin://mathspace/ is surface/dist/.
  base: './',
  plugins: [wasmAsFile()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
      formats: ['es'],
      // The host's entry check wants `.js`; Vite would pick `.mjs` for a
      // package without "type": "module".
      fileName: () => 'surface.js',
    },
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
    commonjsOptions: {
      include: [/node_modules/, /plugins\/mathspace\/[^/]+\.js$/],
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    // The dev page mounts dist/surface.js, and Vite's watcher skips the
    // build outDir by default; watch it so a rebuild invalidates the served
    // copy instead of leaving the last transform in the module cache.
    watch: { ignored: ['!**/dist/**'] },
  },
})
