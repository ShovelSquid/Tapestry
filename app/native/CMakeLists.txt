cmake_minimum_required(VERSION 3.24)
project(tapestry_addon LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ---------------------------------------------------------------------------
# cmake-js integration: it sets these variables when invoking CMake.
# CMAKE_JS_INC  — Node.js and node-addon-api include directories
# CMAKE_JS_LIB  — Node.js import library (Windows)
# CMAKE_JS_SRC  — node_api.h location
# ---------------------------------------------------------------------------
include_directories(SYSTEM ${CMAKE_JS_INC})

# ---------------------------------------------------------------------------
# Add the tapestry kernel as a subdirectory. The kernel's CMakeLists.txt
# respects these options to build only the static library — no SDL app,
# no OpenGL renderer, no test binary.
# ---------------------------------------------------------------------------
set(TAPESTRY_BUILD_APP OFF CACHE BOOL "" FORCE)
set(TAPESTRY_BUILD_RENDER OFF CACHE BOOL "" FORCE)
set(TAPESTRY_BUILD_TESTS OFF CACHE BOOL "" FORCE)

# The kernel source tree is at ../../tapestry relative to this file.
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../tapestry
                 ${CMAKE_CURRENT_BINARY_DIR}/tapestry)

# ---------------------------------------------------------------------------
# The native addon shared library. cmake-js expects the output to be a
# .node file (a shared library with a .node extension).
# ---------------------------------------------------------------------------
add_library(tapestry_addon SHARED addon.cpp ${CMAKE_JS_SRC})
set_target_properties(tapestry_addon PROPERTIES
    PREFIX ""
    SUFFIX ".node"
)

target_link_libraries(tapestry_addon PRIVATE tapestry_kernel)

# node-addon-api: find the include directory via the node module.
# cmake-js sets NODE_ADDON_API_DIR or we find it from node_modules.
execute_process(
    COMMAND node -p "require('node-addon-api').include"
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
# Strip surrounding quotes if present (node -p wraps in quotes on some platforms)
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
target_include_directories(tapestry_addon SYSTEM PRIVATE ${NODE_ADDON_API_DIR})

# N-API: do not throw C++ exceptions — use Napi::Error instead.
target_compile_definitions(tapestry_addon PRIVATE NAPI_DISABLE_CPP_EXCEPTIONS)
