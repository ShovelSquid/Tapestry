// Types for the Emscripten glue copied into surface/wasm/ by build-wasm.sh.
declare module '*/ddsim.mjs' {
  import type { CreateDdsim } from './ddsim-abi'
  const createDdsim: CreateDdsim
  export default createDdsim
}
