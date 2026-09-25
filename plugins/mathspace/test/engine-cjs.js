/**
 * engine-cjs.js — ESM face of ../engine.js for the tests. engine.js is
 * CommonJS (the host require()s it); Vitest transforms test files as ESM,
 * so a real Node require() is the reliable way to load it unchanged.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const engine = require('../engine.js')

export const { loadModule, Engine, hexOf, GLUE_PATH } = engine
