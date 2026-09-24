/** ESM face of ../image.js for the tests; see engine-cjs.js for why. */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const image = require('../image.js')

export const {
  FX_ONE, IMPLICIT_SPACE_ID, IMPLICIT_SPACE_DIM, SPACE_TYPE,
  realToRaw, rawToReal, nodeIdToU64, u64ToNodeId, parseKey, laneKey, kernelName,
  encodeCreateSpace, encodeCreateNote, encodeSetField, encodeBindField,
  buildImage, parseSnapshot, diff, engineSource,
} = image
