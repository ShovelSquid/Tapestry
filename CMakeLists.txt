cmake_minimum_required(VERSION 3.24)

project(mathspace
    VERSION 0.1.0
    DESCRIPTION "mathspace: deterministic fixed-point rule engine over Tapestry notes"
    LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

option(DDSIM_BUILD_TESTS "Build the doctest suite and the replay CLI" ON)
option(DDSIM_SANITIZE "Build every target with UBSan (-fsanitize=undefined, no recovery)" OFF)
set(DDSIM_DOCTEST_DIR "${PROJECT_SOURCE_DIR}/../../tapestry/third_party/doctest" CACHE PATH
    "Directory holding doctest.h and doctest.cmake (test-only dependency)")
set(DDSIM_EMSDK_VERSION "6.0.10" CACHE STRING
    "Pinned Emscripten version; the wasm build refuses any other")

# ---------------------------------------------------------------------------
# Toolchain pin. A toolchain change is a "pinned version" in the core value
# statement, so the Wasm build refuses an Emscripten that is not the one the
# goldens were produced with. Tests are native-only.
# ---------------------------------------------------------------------------
if(EMSCRIPTEN)
    set(DDSIM_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    if(NOT DEFINED EMSCRIPTEN_VERSION)
        message(FATAL_ERROR "mathspace: EMSCRIPTEN_VERSION is not set by the toolchain file")
    endif()
    if(NOT EMSCRIPTEN_VERSION STREQUAL DDSIM_EMSDK_VERSION)
        message(FATAL_ERROR
            "mathspace: Emscripten ${EMSCRIPTEN_VERSION} found but ${DDSIM_EMSDK_VERSION} is pinned "
            "(DDSIM_EMSDK_VERSION); activate the pinned emsdk before building the wasm preset")
    endif()
    message(STATUS "mathspace: Emscripten ${EMSCRIPTEN_VERSION} matches the pin")
endif()

# ---------------------------------------------------------------------------
# SIM-01 gate, configure-time half: the same script CTest runs, so `cmake -B`
# itself fails when a floating-point type, <cmath>, <random> or an unordered
# container appears anywhere under include/, src/ or wasm/.
# ---------------------------------------------------------------------------
set(ROOT ${PROJECT_SOURCE_DIR})
include(${PROJECT_SOURCE_DIR}/cmake/forbidden_tokens.cmake)
unset(ROOT)

# ---------------------------------------------------------------------------
# Shared compile settings.
#
# Determinism rule, inherited from the kernel and semantic-world: no
# fast-math, no FP contraction. -fwrapv makes signed wrap-around defined so
# the native and wasm optimisers cannot exploit it differently (RESEARCH
# pitfall 2); it is PUBLIC through this interface so every consumer,
# including the Emscripten link, inherits it.
# ---------------------------------------------------------------------------
add_library(ddsim_settings INTERFACE)
target_compile_features(ddsim_settings INTERFACE cxx_std_20)
target_compile_options(ddsim_settings INTERFACE
    -Wall -Wextra -Wpedantic -Wshadow -Wconversion
    -ffp-contract=off
    -fwrapv)

# UBSan preset (native-ubsan): the sanitizer rides the same interface so the
# library, the tests, the fixture generator and the replay CLI are all
# instrumented — pitfall 2 says the full fixture set must run sanitized, not
# a subset. No recovery: the first finding fails the run.
if(DDSIM_SANITIZE)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
        target_compile_options(ddsim_settings INTERFACE -fsanitize=undefined -fno-sanitize-recover=all)
        target_link_options(ddsim_settings INTERFACE -fsanitize=undefined -fno-sanitize-recover=all)
        message(STATUS "mathspace: UBSan enabled on every target (DDSIM_SANITIZE=ON)")
    else()
        message(FATAL_ERROR "mathspace: DDSIM_SANITIZE needs Clang or GCC, found ${CMAKE_CXX_COMPILER_ID}")
    endif()
endif()

# ---------------------------------------------------------------------------
# Vendored dependency of the library itself — the only one.
#
# PicoSHA2 — single-header SHA-256 for state hashes and golden digests.
# Upstream https://github.com/okdshin/PicoSHA2, pinned to master commit
# 161cb3fc4170fa7a3eca9e582cebd27cc4d1fe29 (2025-05-04).
# MIT license — see third_party/picosha2/LICENSE.
# The same header the kernel vendors, copied rather than linked so the
# engine has no dependency on the kernel tree. SYSTEM include: not ours to
# keep warning-clean. It is included by exactly one translation unit
# (src/mathspace/hash.cpp).
#
# mathspace — the schema-less spatial note store (mathspace_design.md,
# mathspace_plan.md), the whole library since plan phase 7 folded ddsim
# in: fx64, the RNG and fxmath live under include/mathspace/.
# ---------------------------------------------------------------------------
file(GLOB MATHSPACE_SOURCES CONFIGURE_DEPENDS
    ${PROJECT_SOURCE_DIR}/src/mathspace/*.cpp
    ${PROJECT_SOURCE_DIR}/src/mathspace/expr/*.cpp)
add_library(mathspace STATIC ${MATHSPACE_SOURCES})
target_include_directories(mathspace PUBLIC ${PROJECT_SOURCE_DIR}/include)
target_include_directories(mathspace SYSTEM PRIVATE ${PROJECT_SOURCE_DIR}/third_party/picosha2)
target_link_libraries(mathspace PUBLIC ddsim_settings)

# ---------------------------------------------------------------------------
# Tests and the replay CLI. doctest is the repo's vendored copy
# (third_party/doctest, tag v2.5.3), reached through DDSIM_DOCTEST_DIR — a
# test-only dependency, so the library stays at zero.
# ---------------------------------------------------------------------------
if(DDSIM_BUILD_TESTS)
    enable_testing()

    add_library(doctest INTERFACE)
    target_include_directories(doctest SYSTEM INTERFACE ${DDSIM_DOCTEST_DIR})
    add_library(doctest::doctest ALIAS doctest)
    include(${DDSIM_DOCTEST_DIR}/doctest.cmake)

    file(GLOB MATHSPACE_TEST_SOURCES CONFIGURE_DEPENDS ${PROJECT_SOURCE_DIR}/tests/mathspace/*.cpp)
    add_executable(mathspace_tests ${MATHSPACE_TEST_SOURCES})
    target_link_libraries(mathspace_tests PRIVATE mathspace doctest::doctest)
    target_compile_definitions(mathspace_tests PRIVATE
        MATHSPACE_GOLDEN_DIR="${PROJECT_SOURCE_DIR}/tests/golden/ms")
    doctest_discover_tests(mathspace_tests TEST_PREFIX ms.)

    # SIM-01 gate, CTest half.
    add_test(NAME ddsim_forbidden_tokens
        COMMAND ${CMAKE_COMMAND} -DROOT=${PROJECT_SOURCE_DIR}
                -P ${PROJECT_SOURCE_DIR}/cmake/forbidden_tokens.cmake)

    # Headless replay CLI — the tool a person runs to verify "same file, same
    # seed, same hash". It drives mathspace::World directly and shares the
    # fixture parser with the tests (tests/mathspace/fixture.hpp).
    #
    # SIM-02, two-process half: every committed fixture is replayed by two
    # fresh processes (different ASLR, allocator state) whose outputs must be
    # identical to each other and to the committed .sha256, then once more
    # with --roundtrip (serialize/restore into a second world at every
    # checkpoint). Both native presets run this against the same committed
    # golden, so Debug-vs-Release equality is checked on every run.
    add_executable(ms_replay tools/ms_replay/main.cpp)
    target_link_libraries(ms_replay PRIVATE mathspace)
    target_include_directories(ms_replay PRIVATE ${PROJECT_SOURCE_DIR}/tests/mathspace)
    target_compile_definitions(ms_replay PRIVATE
        MATHSPACE_GOLDEN_DIR="${PROJECT_SOURCE_DIR}/tests/golden/ms")

    file(GLOB MATHSPACE_FIXTURES CONFIGURE_DEPENDS ${PROJECT_SOURCE_DIR}/tests/golden/ms/*.actions)
    foreach(fixture IN LISTS MATHSPACE_FIXTURES)
        get_filename_component(fixture_name ${fixture} NAME_WE)
        get_filename_component(fixture_dir ${fixture} DIRECTORY)
        add_test(NAME ms_golden_two_process_${fixture_name}
            COMMAND ${CMAKE_COMMAND}
                -DREPLAY=$<TARGET_FILE:ms_replay>
                -DACTIONS=${fixture}
                -DEXPECTED=${fixture_dir}/${fixture_name}.sha256
                -DWORK=${CMAKE_CURRENT_BINARY_DIR}/two_process_ms
                -P ${PROJECT_SOURCE_DIR}/cmake/two_process.cmake)
    endforeach()
endif()

# ---------------------------------------------------------------------------
# Wasm module: the same library, one link root, an ES module the renderer
# worker and Node can both import. EXPORTED_FUNCTIONS lists every ms_*
# symbol from mathspace_c.h plus malloc/free for action buffers.
# ---------------------------------------------------------------------------
if(EMSCRIPTEN)
    add_executable(mathspace_wasm wasm/mathspace_wasm.cpp)
    target_link_libraries(mathspace_wasm PRIVATE mathspace)
    set_target_properties(mathspace_wasm PROPERTIES OUTPUT_NAME mathspace SUFFIX .mjs)
    target_link_options(mathspace_wasm PRIVATE
        -O2
        -sMODULARIZE=1
        -sEXPORT_ES6=1
        -sENVIRONMENT=web,worker,node
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=33554432
        -sSTACK_SIZE=1048576
        -sEXPORT_NAME=createMathspace
        --no-entry
        "-sEXPORTED_FUNCTIONS=_ms_version,_ms_create,_ms_destroy,_ms_apply,_ms_step,_ms_tick,_ms_hash,_ms_serialize,_ms_restore,_ms_notes_ptr,_ms_notes_len,_ms_errors_ptr,_ms_errors_len,_ms_skip_reason_name,_ms_compile,_ms_compile_error_name,_ms_project,_malloc,_free"
        "-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32,HEAPU32,UTF8ToString")
endif()
