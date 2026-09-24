# forbidden_tokens.cmake — the SIM-01 build gate.
#
# Scans the sim's own sources (include/, src/, wasm/ — never third_party/,
# tests/ or tools/) for the two C++ floating-point type keywords as whole
# words, the C math header, the C++ random header, or any unordered
# container. One match fails the run with FATAL_ERROR.
#
# Runs twice: include()d from CMakeLists.txt so `cmake -B` itself fails, and
# as the CTest test `ddsim_forbidden_tokens` via `cmake -DROOT=... -P`.
if(NOT DEFINED ROOT)
    message(FATAL_ERROR "forbidden_tokens.cmake: ROOT is not set")
endif()

file(GLOB_RECURSE DDSIM_GATE_SOURCES
    ${ROOT}/include/*.hpp
    ${ROOT}/include/*.h
    ${ROOT}/src/*.cpp
    ${ROOT}/wasm/*.cpp)

set(DDSIM_GATE_REGEX "(^|[^A-Za-z0-9_])(float|double)([^A-Za-z0-9_]|$)|<cmath>|<random>|unordered_")

list(LENGTH DDSIM_GATE_SOURCES DDSIM_GATE_COUNT)
if(DDSIM_GATE_COUNT EQUAL 0)
    message(FATAL_ERROR "forbidden_tokens.cmake: no sim sources found under ${ROOT}")
endif()

foreach(f IN LISTS DDSIM_GATE_SOURCES)
    file(READ "${f}" DDSIM_GATE_TEXT)
    if("${DDSIM_GATE_TEXT}" MATCHES "${DDSIM_GATE_REGEX}")
        message(FATAL_ERROR "forbidden token in ${f}")
    endif()
endforeach()

message(STATUS "ddsim_forbidden_tokens: ${DDSIM_GATE_COUNT} sim sources are clean")
