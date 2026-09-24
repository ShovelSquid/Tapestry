/**
 * engine.ts — the plugin's CommonJS pieces as ES exports for the bundle.
 * Vite's CommonJS transform (vite.config.ts) turns these requires into
 * imports at build time; engine.js (the Node loader) is deliberately not
 * among them.
 */
// @ts-expect-error CommonJS module typed by engine.d.ts
import world from '../../world.js'
// @ts-expect-error CommonJS module typed by engine.d.ts
import projection from '../../projection.js'
import type { Engine, Image, Projection } from './types'

export type { Engine, Image, Projection }
export const buildWorld: (nodes: unknown[], mod: unknown) => { engine: Engine; image: Image } = world.buildWorld
export const projectAll: (engine: Engine, image: Image) => Projection = projection.projectAll
