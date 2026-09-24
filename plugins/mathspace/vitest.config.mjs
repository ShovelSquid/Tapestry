import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * The golden test loads the real wasm/mathspace.mjs (from
 * `npm run engine:wasm`) in Node. Single pass, no watch.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    exclude: ['node_modules/**', 'wasm/**'],
    testTimeout: 30000,
  },
})
