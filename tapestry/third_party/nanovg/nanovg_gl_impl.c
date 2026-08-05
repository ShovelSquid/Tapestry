/* Single translation unit that instantiates nanovg's OpenGL 3 backend.
 *
 * glad has to come first: nanovg_gl.h calls GL entry points directly and does
 * not declare them itself, so without the loader header in scope this fails to
 * compile with a wall of implicit-declaration errors that look unrelated.
 *
 * Keeping the instantiation in its own file (rather than defining
 * NANOVG_GL3_IMPLEMENTATION in application code) means the backend is compiled
 * exactly once and the vendored headers stay byte-identical to upstream. */

#include <glad/gl.h>

/* nanovg.h is needed here too, not just by the implementation block below:
 * nanovg_gl.h declares its public functions in terms of NVGcontext above the
 * NANOVG_GL_IMPLEMENTATION guard, but only includes nanovg.h inside it. */
#include "nanovg.h"

#define NANOVG_GL3_IMPLEMENTATION
#include "nanovg_gl.h"
