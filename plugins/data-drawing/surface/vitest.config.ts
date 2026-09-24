import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for the Data Drawing surface.
 *
 * The golden test loads the real mathspace Wasm module (surface/wasm/mathspace.mjs,
 * produced by `npm run sim:wasm`) in the Node environment. No pool: 'forks'
 * — that setting exists in the app only for the native addon's per-process
 * journal lock, and no addon is involved here.
 *
 * No watch settings: every run is a single pass (`vitest run`).
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'wasm/**'],
    testTimeout: 30000,
  },
})
