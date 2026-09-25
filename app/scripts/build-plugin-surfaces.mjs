#!/usr/bin/env node
/**
 * Build every plugin surface the app can open.
 *
 * The app imports a surface over `tapestry-plugin://<plugin>/<entry>`, and a
 * plugin whose surface is a bundled project points `entry` at build output
 * that is gitignored (e.g. `surface/dist/surface.js`). Nothing produced it on
 * a fresh checkout, so "Open <surface>" failed to load. This runs before
 * electron-vite in `dev`, `build` and `build:js`.
 *
 * Generic, no plugin names in here: a plugin opts in by defining an npm
 * script named `build:surface` in its package.json. `build:surface` rather
 * than `build` because `build` means different things across packages (sdk's
 * is `tsc`), and a plugin should be able to have a heavier `build` the app
 * does not want to run on every launch. Plugins without the script (a plain
 * JS surface needs no step) are skipped.
 *
 * Inputs the surface build needs but cannot make itself (Wasm compiled with
 * Emscripten, which the app build must not require) are declared in the
 * plugin's package.json:
 *
 *   "tapestrySurface": {
 *     "requires": ["wasm/mathspace.wasm"],
 *     "missingHint": "npm --prefix plugins/mathspace run engine:wasm (needs Emscripten at $EMSDK)"
 *   }
 *
 * A plugin with a missing input is skipped with a loud warning rather than
 * failing the app build: the rest of the app still launches, and only that
 * surface shows its load error. Pass `--strict` to make that an error (for
 * packaging). A `build:surface` that runs and fails is always an error.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SURFACE_SCRIPT = 'build:surface'

/**
 * One entry per plugin directory that defines `build:surface`, in name
 * order, with the declared inputs that are not on disk.
 * @param {string} pluginsDir
 * @returns {{ name: string, dir: string, missing: string[], hint: string | undefined }[]}
 */
export function planSurfaceBuilds(pluginsDir) {
  if (!existsSync(pluginsDir)) return []
  const plans = []
  const dirs = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  for (const name of dirs) {
    const dir = join(pluginsDir, name)
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) continue
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch (err) {
      throw new Error(`${pkgPath}: invalid JSON (${err.message})`)
    }
    if (typeof pkg?.scripts?.[SURFACE_SCRIPT] !== 'string') continue
    const surface = pkg.tapestrySurface ?? {}
    const requires = Array.isArray(surface.requires) ? surface.requires : []
    const missing = requires.filter((rel) => !existsSync(join(dir, rel)))
    const hint = typeof surface.missingHint === 'string' ? surface.missingHint : undefined
    plans.push({ name, dir, missing, hint })
  }
  return plans
}

function warnMissing(plan) {
  const lines = [
    `plugin "${plan.name}": surface NOT built, missing input(s):`,
    ...plan.missing.map((m) => `  - ${join(plan.dir, m)}`),
    plan.hint ? `build them with: ${plan.hint}` : `see plugins/${plan.name}/package.json for how to build them`,
    `"Open" on this plugin's surface will fail to load until then.`,
  ]
  const bar = '!'.repeat(72)
  console.warn(`\n\x1b[33m${bar}\n${lines.join('\n')}\n${bar}\x1b[0m\n`)
}

function main(argv) {
  const strict = argv.includes('--strict')
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const plans = planSurfaceBuilds(join(root, 'plugins'))
  let failed = 0
  for (const plan of plans) {
    if (plan.missing.length > 0) {
      warnMissing(plan)
      if (strict) failed++
      continue
    }
    console.log(`[build-plugin-surfaces] ${plan.name}: npm run ${SURFACE_SCRIPT}`)
    const res = spawnSync('npm', ['run', '--silent', SURFACE_SCRIPT], {
      cwd: plan.dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    if (res.status !== 0) {
      console.error(`[build-plugin-surfaces] ${plan.name}: ${SURFACE_SCRIPT} failed (exit ${res.status ?? res.signal})`)
      failed++
    }
  }
  if (plans.length === 0) console.log('[build-plugin-surfaces] no plugin defines build:surface')
  return failed === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
