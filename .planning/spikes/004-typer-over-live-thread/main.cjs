// Spike 004-typer-over-live-thread launcher; see ../002-shared/launch.cjs for flags (--shots, --bench).
// Scripted runs drive real Chromium key events through the launcher's send-input handler.
process.env.TAPESTRY_SPIKES_DIR = require('path').resolve(__dirname, '..')
require('../002-shared/launch.cjs')('004-typer-over-live-thread')
