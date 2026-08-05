# ---------------------------------------------------------------------------
# nanovg — vendored rather than fetched.
#
# Upstream (https://github.com/memononen/nanovg) has no CMakeLists and is
# effectively unmaintained, so pinning a FetchContent tag would buy nothing over
# copying seven files in. Vendoring also keeps `cmake` working with no network.
#
# Pinned to upstream commit ce3bf745eb2d2dbc14a50bf2446783f691ac4353.
# zlib license — see nanovg/LICENSE.txt.
# ---------------------------------------------------------------------------
add_library(nanovg STATIC
    nanovg/nanovg.c
    nanovg/nanovg_gl_impl.c)

# SYSTEM so that nanovg.h's GNU anonymous structs do not trip -Wpedantic in the
# translation units that include it.
target_include_directories(nanovg SYSTEM PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/nanovg)

# nanovg_gl.h declares nvgCreateGL3/nvgDeleteGL3 only when NANOVG_GL3 is
# defined; the *_IMPLEMENTATION define sets it for the backend TU but consumers
# have to set it themselves. Doing it here means no caller has to remember, and
# the backend selection lives in exactly one place.
target_compile_definitions(nanovg PUBLIC NANOVG_GL3)

# nanovg_gl_impl.c includes <glad/gl.h>, so the loader must be on its include
# path — PUBLIC because our own code includes nanovg_gl.h too.
target_link_libraries(nanovg PUBLIC glad_gl_core_33)

# Vendored code is deliberately exempt from our warning settings: it is kept
# byte-identical to upstream so future diffs stay readable, and our flags
# (-Wconversion in particular) light it up with noise we would never act on.
if(MSVC)
    target_compile_options(nanovg PRIVATE /w)
else()
    target_compile_options(nanovg PRIVATE -w)
endif()

# ---------------------------------------------------------------------------
# stb_image_write — public domain, used only by `--screenshot` to dump the
# framebuffer to PNG. Keeping visual verification inside the app means never
# having to capture the whole desktop to check that something rendered.
# ---------------------------------------------------------------------------
add_library(stb_image_write STATIC stb/stb_image_write_impl.c)
target_include_directories(stb_image_write SYSTEM PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/stb)

if(MSVC)
    target_compile_options(stb_image_write PRIVATE /w)
else()
    target_compile_options(stb_image_write PRIVATE -w)
endif()
