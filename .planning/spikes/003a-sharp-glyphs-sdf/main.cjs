// Spike 003a-sharp-glyphs-sdf launcher; see ../002-shared/launch.cjs for flags (--shots, --bench, --no-typing).
process.env.TAPESTRY_SPIKES_DIR = require('path').resolve(__dirname, '..')
require('../002-shared/launch.cjs')('003a-sharp-glyphs-sdf')
