'use strict'

const fs = require('fs')
const path = require('path')

// The kernel addon: TAPESTRY_ADDON if set, else the app's own build
// (`npm run build:native` in app/).
function addonPath() {
  const candidates = [
    process.env.TAPESTRY_ADDON,
    path.join(__dirname, '../../../app/native/build/Release/tapestry_addon.node'),
  ].filter(Boolean)
  const found = candidates.find((p) => fs.existsSync(p))
  if (!found) {
    throw new Error('kernel addon not found: run `npm run build:native` in app/, or set TAPESTRY_ADDON')
  }
  return found
}

module.exports = { addonPath }
