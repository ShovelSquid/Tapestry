import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for the Tapestry app.
 *
 * The main-process code under test loads the native C++ addon through
 * require(), so tests run in the Node environment rather than jsdom.
 *
 * pool: 'forks' is required, not a preference: the addon's journal sink holds
 * flock(LOCK_EX) for the life of an open world, and the lock is per process.
 * Worker threads would share one process (and therefore one lock table), so
 * two tests opening different worlds could see each other's locks.
 *
 * No watch settings: every run is a single pass (`vitest run`).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['out/**', 'node_modules/**', 'native/**'],
    pool: 'forks',
    testTimeout: 30000,
  },
})
