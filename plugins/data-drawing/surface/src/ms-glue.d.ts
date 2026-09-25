// Types for the mathspace Emscripten glue copied into surface/wasm/ by build-wasm.sh.
declare module '*/mathspace.mjs' {
  import type { CreateMathspace } from './ms-abi'
  const createMathspace: CreateMathspace
  export default createMathspace
}
