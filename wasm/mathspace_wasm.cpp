// mathspace_wasm.cpp — the Emscripten link root for the mathspace engine.
// Wrapper only, like ddsim_wasm.cpp: including the C ABI header gives each
// ms_* symbol EMSCRIPTEN_KEEPALIVE in this build, and the
// -sEXPORTED_FUNCTIONS list in CMakeLists.txt names them for wasm-ld, which
// pulls their definitions out of libmathspace.a. No logic lives here.
#include "mathspace/mathspace_c.h"
