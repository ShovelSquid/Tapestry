cmake_minimum_required(VERSION 3.24)

project(tapestry
    VERSION 0.1.0
    DESCRIPTION "Spatial workspace for conversations, notes, and files"
    LANGUAGES C CXX) # C is required: nanovg and glad are C.

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "Build type" FORCE)
endif()

option(TAPESTRY_BUILD_APP "Build the SDL2 application" ON)
option(TAPESTRY_BUILD_TESTS "Build the test suite" ON)
option(TAPESTRY_BUILD_RENDER "Build glad/nanovg, the legacy tapestry_core and its tests" ON)

# ---------------------------------------------------------------------------
# Shared compile settings.
#
# Determinism rule, inherited from semantic-world: no fast-math, no FP
# contraction. The simulation must produce identical results across compilers
# and optimisation levels, so a stray float can never silently depend on
# compiler-chosen contraction.
# ---------------------------------------------------------------------------
add_library(tapestry_settings INTERFACE)
target_compile_features(tapestry_settings INTERFACE cxx_std_20)

if(MSVC)
    target_compile_options(tapestry_settings INTERFACE /W4 /permissive- /fp:strict)
else()
    target_compile_options(tapestry_settings INTERFACE
        -Wall -Wextra -Wpedantic -Wshadow -Wconversion
        -ffp-contract=off)
endif()

# ---------------------------------------------------------------------------
# Kernel dependencies — vendored rather than fetched, so the kernel configures
# and builds with no network, no Python, and no renderer.
#
# doctest — single-header test framework plus its two CTest discovery scripts.
# Upstream https://github.com/doctest/doctest, pinned to tag v2.5.3
# (doctest/doctest.h, scripts/cmake/doctest.cmake,
# scripts/cmake/doctestAddTests.cmake, LICENSE.txt).
# MIT license — see third_party/doctest/LICENSE.txt.
#
# PicoSHA2 — single-header SHA-256 for record digests and the parent chain.
# Upstream https://github.com/okdshin/PicoSHA2, pinned to master commit
# 161cb3fc4170fa7a3eca9e582cebd27cc4d1fe29 (2025-05-04).
# MIT license — see third_party/picosha2/LICENSE.
#
# Both are SYSTEM includes: their code is not ours to keep warning-clean.
# ---------------------------------------------------------------------------
add_library(doctest INTERFACE)
target_include_directories(doctest SYSTEM INTERFACE ${PROJECT_SOURCE_DIR}/third_party/doctest)
add_library(doctest::doctest ALIAS doctest)

# ---------------------------------------------------------------------------
# Kernel library — typed values, identifiers, time, the generic world, and the
# .tree journal. No glad, no nanovg, no SDL, no display: it links only the
# shared settings so it builds offline and headless anywhere a C++20 compiler
# exists. Sources are globbed with CONFIGURE_DEPENDS so adding a kernel file
# never requires editing this list.
# ---------------------------------------------------------------------------
file(GLOB_RECURSE TAPESTRY_KERNEL_SOURCES CONFIGURE_DEPENDS ${PROJECT_SOURCE_DIR}/kernel/*.cpp)
add_library(tapestry_kernel STATIC ${TAPESTRY_KERNEL_SOURCES})
target_include_directories(tapestry_kernel PUBLIC ${PROJECT_SOURCE_DIR})
target_include_directories(tapestry_kernel SYSTEM PRIVATE ${PROJECT_SOURCE_DIR}/third_party/picosha2)
target_link_libraries(tapestry_kernel PUBLIC tapestry_settings)

# ---------------------------------------------------------------------------
# Kernel tests. One doctest binary; every TEST_CASE is registered with CTest
# individually so a single case can be run from ctest as well as via the
# binary's own -ts= / -tc= filters.
# ---------------------------------------------------------------------------
if(TAPESTRY_BUILD_TESTS)
    enable_testing()

    file(GLOB TAPESTRY_KERNEL_TEST_SOURCES CONFIGURE_DEPENDS ${PROJECT_SOURCE_DIR}/kernel_tests/*.cpp)
    add_executable(tapestry_kernel_tests ${TAPESTRY_KERNEL_TEST_SOURCES})
    target_link_libraries(tapestry_kernel_tests PRIVATE tapestry_kernel doctest::doctest)
    target_compile_definitions(tapestry_kernel_tests PRIVATE
        TAPESTRY_FIXTURE_DIR="${PROJECT_SOURCE_DIR}/docs/tree")

    include(${PROJECT_SOURCE_DIR}/third_party/doctest/doctest.cmake)
    doctest_discover_tests(tapestry_kernel_tests)
endif()

# ---------------------------------------------------------------------------
# Render stack. Everything below needs an OpenGL loader generated at configure
# time (Python + Jinja2 + network) and the vendored nanovg, so it is gated:
# a kernel-only configure must never touch FetchContent or the display stack.
# ---------------------------------------------------------------------------
if(TAPESTRY_BUILD_RENDER)

# ---------------------------------------------------------------------------
# glad — OpenGL 3.3 core loader.
#
# 3.3 is a hard ceiling, not a default. Apple froze OpenGL at 4.1 and never
# shipped compute shaders or SSBOs, so raising this costs the macOS build for
# no gain (see chrono_magnetic_particles/logs/2026-07-30-macos-opengl-blocker.md).
#
# glad2 has no CMakeLists.txt at its repository root — the build system lives in
# cmake/, hence SOURCE_SUBDIR. It also generates its loader at configure time
# using Python + Jinja2; both must be installed or configuration fails with an
# unrelated-looking error.
# ---------------------------------------------------------------------------
include(FetchContent)
FetchContent_Declare(glad
    GIT_REPOSITORY https://github.com/Dav1dde/glad.git
    GIT_TAG v2.0.8
    SOURCE_SUBDIR cmake)
FetchContent_MakeAvailable(glad)
glad_add_library(glad_gl_core_33 REPRODUCIBLE API gl:core=3.3)

add_subdirectory(third_party)

# ---------------------------------------------------------------------------
# Core library — camera, geometry, the page world, and rendering primitives.
# No windowing, no SDL, no event loop, so it stays testable without a display.
# ---------------------------------------------------------------------------
add_library(tapestry_core STATIC
    core/Camera.cpp
    core/Document.cpp
    core/World.cpp
    render/Fonts.cpp
    render/Grid.cpp
    render/Pages.cpp)
target_sources(tapestry_core PRIVATE render/Strokes.cpp)

target_include_directories(tapestry_core PUBLIC ${PROJECT_SOURCE_DIR})
target_link_libraries(tapestry_core
    PUBLIC tapestry_settings nanovg)

# ---------------------------------------------------------------------------
# Application. Optional: the core library must always build on machines with no
# SDL2 and no display.
# ---------------------------------------------------------------------------
if(TAPESTRY_BUILD_APP)
    if(APPLE)
        # Homebrew installs sdl2-config.cmake outside CMake's default search path.
        find_program(TAPESTRY_BREW_EXECUTABLE brew)
        if(TAPESTRY_BREW_EXECUTABLE)
            execute_process(COMMAND ${TAPESTRY_BREW_EXECUTABLE} --prefix sdl2
                OUTPUT_VARIABLE TAPESTRY_BREW_SDL2_PREFIX
                OUTPUT_STRIP_TRAILING_WHITESPACE
                ERROR_QUIET)
            if(TAPESTRY_BREW_SDL2_PREFIX)
                list(APPEND CMAKE_PREFIX_PATH "${TAPESTRY_BREW_SDL2_PREFIX}")
            endif()
        endif()
    endif()

    find_package(SDL2 QUIET)

    if(NOT SDL2_FOUND)
        find_package(PkgConfig QUIET)
        if(PkgConfig_FOUND)
            pkg_check_modules(SDL2 IMPORTED_TARGET sdl2)
            if(SDL2_FOUND AND NOT TARGET SDL2::SDL2)
                add_library(SDL2::SDL2 ALIAS PkgConfig::SDL2)
            endif()
        endif()
    endif()

    if(SDL2_FOUND)
        set(TAPESTRY_APP_SOURCES app/main.cpp)
        if(APPLE)
            enable_language(OBJCXX)
            list(APPEND TAPESTRY_APP_SOURCES app/FileDialog_mac.mm)
        else()
            list(APPEND TAPESTRY_APP_SOURCES app/FileDialog.cpp)
        endif()

        add_executable(tapestry ${TAPESTRY_APP_SOURCES})

        target_link_libraries(tapestry PRIVATE tapestry_core stb_image_write)
        target_compile_definitions(tapestry PRIVATE
            TAPESTRY_ASSET_DIR="${PROJECT_SOURCE_DIR}/assets")

        if(APPLE)
            target_link_libraries(tapestry PRIVATE "-framework AppKit")
        elseif(WIN32)
            target_link_libraries(tapestry PRIVATE comdlg32)
        endif()

        if(TARGET SDL2::SDL2)
            target_link_libraries(tapestry PRIVATE SDL2::SDL2)
        else()
            # Older SDL2 packages (e.g. Raspberry Pi OS) export variables only.
            target_include_directories(tapestry PRIVATE ${SDL2_INCLUDE_DIRS})
            target_link_libraries(tapestry PRIVATE ${SDL2_LIBRARIES})
        endif()

        if(TARGET SDL2::SDL2main)
            target_link_libraries(tapestry PRIVATE SDL2::SDL2main)
        endif()
    else()
        message(WARNING
            "SDL2 not found — skipping the 'tapestry' application target. "
            "The core library still builds. "
            "Install SDL2 (brew install sdl2 / apt install libsdl2-dev) to enable it.")
    endif()
endif()

# ---------------------------------------------------------------------------
# Legacy tests. No framework: these are pure-arithmetic invariants over the
# core library, and they run with no window, no GL context, and no display.
# ---------------------------------------------------------------------------
if(TAPESTRY_BUILD_TESTS)
    add_executable(tapestry_tests tests/CameraTest.cpp)
    target_link_libraries(tapestry_tests PRIVATE tapestry_core)

    add_executable(tapestry_world_tests tests/WorldTest.cpp)
    target_link_libraries(tapestry_world_tests PRIVATE tapestry_core)

    add_executable(tapestry_document_tests tests/DocumentTest.cpp)
    target_link_libraries(tapestry_document_tests PRIVATE tapestry_core)

    add_test(NAME camera COMMAND tapestry_tests)
    add_test(NAME world COMMAND tapestry_world_tests)
    add_test(NAME document COMMAND tapestry_document_tests)
endif()

endif() # TAPESTRY_BUILD_RENDER
