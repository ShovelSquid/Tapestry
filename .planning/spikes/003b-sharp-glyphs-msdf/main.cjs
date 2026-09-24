// Spike 003b-sharp-glyphs-msdf launcher; see ../002-shared/launch.cjs for flags (--shots, --bench, --no-typing) plus --no-preprocess.
process.env.TAPESTRY_SPIKES_DIR = require('path').resolve(__dirname, '..')
// --no-preprocess skips msdfgen's Skia shape preprocessing, to see what it costs.
if (process.argv.includes('--no-preprocess')) process.env.TAPESTRY_MSDF_PREPROCESS = '0'
require('../002-shared/launch.cjs')('003b-sharp-glyphs-msdf')
