// ddsim_wasm.cpp — the Emscripten link root. Wrapper only: it includes the C
// ABI header so each dd_* symbol carries EMSCRIPTEN_KEEPALIVE in this build,
// and the -sEXPORTED_FUNCTIONS list in CMakeLists.txt names them for wasm-ld,
// which pulls their definitions out of libddsim.a. No logic lives here;
// validation is the library's.
#include "ddsim/ddsim_c.h"
