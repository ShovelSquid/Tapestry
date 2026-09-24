/** The Emscripten glue: a factory returning the instantiated module. */
declare module '*/mathspace.mjs' {
  const createModule: () => Promise<unknown>
  export default createModule
}
