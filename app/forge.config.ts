/**
 * Electron Forge configuration for packaging the Tapestry application.
 *
 * Uses the pre-built output from electron-vite (in app/out/) and packages
 * it with the native C++ addon and plugins directory.
 *
 * The native addon and plugins are included as extraResource so they
 * load correctly outside asar.
 *
 * NOTE: Electron Forge defaults to ignoring /out/ (its own output dir).
 * Since electron-vite builds to app/out/, we override the ignore to keep
 * that directory and exclude only source/config files.
 */

import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerZIP } from '@electron-forge/maker-zip'
import { join } from 'path'

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Tapestry',
    asar: true,
    // Include native addon and plugins as extraResource (outside asar)
    extraResource: [
      join(__dirname, 'native', 'build', 'Release', 'tapestry_addon.node'),
      join(__dirname, '..', 'plugins'),
    ],
    // Override Forge's default /out/ ignore — electron-vite builds to out/
    // Exclude source files, configs, and the native directory (addon is in extraResource)
    ignore: [
      /^\/src\//,
      /^\/tsconfig/,
      /^\/electron\.vite/,
      /^\/forge\.config/,
      /^\/native\//,
    ],
  },
  // Forge output goes here (not in app/out/ which is electron-vite output)
  outDir: join(__dirname, 'forge-out'),
  makers: [
    new MakerZIP({}),
  ],
}

export default config
