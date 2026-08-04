cmake_minimum_required(VERSION 3.24)

project(semantic_world
    VERSION 0.1.0
    DESCRIPTION "Deterministic semantic world engine"
    LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "Build type" FORCE)
endif()

option(SW_BUILD_APP "Build the SDL2 application" ON)
option(SW_BUILD_TESTS "Build the test suite" ON)
option(SW_FETCH_CATCH2 "Download Catch2 if it is not installed" ON)

# ---------------------------------------------------------------------------
# Shared compile settings
#
# Determinism rule: no fast-math, no FP contraction. The prototype is
# integer-only, but the flags are set now so a stray float can never silently
# depend on compiler-chosen contraction.
# ---------------------------------------------------------------------------
add_library(sw_settings INTERFACE)
target_compile_features(sw_settings INTERFACE cxx_std_20)

if(MSVC)
    target_compile_options(sw_settings INTERFACE /W4 /permissive- /fp:strict)
else()
    target_compile_options(sw_settings INTERFACE
        -Wall -Wextra -Wpedantic -Wshadow -Wconversion
        -ffp-contract=off)
endif()

# ---------------------------------------------------------------------------
# Core simulation library — contains no rendering, no windowing, no SDL.
# ---------------------------------------------------------------------------
add_library(sw_core STATIC
    core/World.cpp
    core/Grid.cpp
    core/StateHash.cpp
    materials/MaterialLibrary.cpp
    rules/RulePipeline.cpp
    rules/GravityRule.cpp
    rules/SandRule.cpp
    rules/WaterRule.cpp
    commands/CommandProcessor.cpp
    events/EventLog.cpp
    events/Replay.cpp
    snapshots/SnapshotStore.cpp
    serialization/JsonEventCodec.cpp)

target_include_directories(sw_core PUBLIC ${PROJECT_SOURCE_DIR})
target_link_libraries(sw_core PUBLIC sw_settings)

# ---------------------------------------------------------------------------
# Application (SDL2 window + input). Optional: the core library and the tests
# must always build on machines with no SDL2 and no display.
# ---------------------------------------------------------------------------
if(SW_BUILD_APP)
    if(APPLE)
        # Homebrew installs sdl2-config.cmake outside CMake's default search path.
        find_program(SW_BREW_EXECUTABLE brew)
        if(SW_BREW_EXECUTABLE)
            execute_process(COMMAND ${SW_BREW_EXECUTABLE} --prefix sdl2
                OUTPUT_VARIABLE SW_BREW_SDL2_PREFIX
                OUTPUT_STRIP_TRAILING_WHITESPACE
                ERROR_QUIET)
            if(SW_BREW_SDL2_PREFIX)
                list(APPEND CMAKE_PREFIX_PATH "${SW_BREW_SDL2_PREFIX}")
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
        add_executable(semantic_world
            app/main.cpp
            rendering/SDLRenderer.cpp)

        target_link_libraries(semantic_world PRIVATE sw_core)

        if(TARGET SDL2::SDL2)
            target_link_libraries(semantic_world PRIVATE SDL2::SDL2)
        else()
            # Older SDL2 packages (e.g. Raspberry Pi OS) export variables only.
            target_include_directories(semantic_world PRIVATE ${SDL2_INCLUDE_DIRS})
            target_link_libraries(semantic_world PRIVATE ${SDL2_LIBRARIES})
        endif()

        if(TARGET SDL2::SDL2main)
            target_link_libraries(semantic_world PRIVATE SDL2::SDL2main)
        endif()
    else()
        message(WARNING
            "SDL2 not found — skipping the 'semantic_world' application target. "
            "The core library and tests still build. "
            "Install SDL2 (brew install sdl2 / apt install libsdl2-dev) to enable it.")
    endif()
endif()

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
if(SW_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
