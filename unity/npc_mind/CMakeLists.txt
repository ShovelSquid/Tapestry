cmake_minimum_required(VERSION 3.24)
project(npc_mind LANGUAGES C CXX)

# Pull in only the Tapestry kernel: no SDL, no GL, no network at configure.
set(TAPESTRY_BUILD_APP OFF CACHE BOOL "" FORCE)
set(TAPESTRY_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(TAPESTRY_BUILD_RENDER OFF CACHE BOOL "" FORCE)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../tapestry tapestry)

add_library(npc_mind_lib STATIC NpcMind.cpp)
target_include_directories(npc_mind_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(npc_mind_lib PUBLIC tapestry_kernel)

add_executable(npc_mind main.cpp)
target_link_libraries(npc_mind PRIVATE npc_mind_lib)

# Smoke test: seeding reproduces the committed example byte for byte, and the
# packet for the player names both opinions with their reasons.
enable_testing()
add_test(NAME npc_mind_smoke
    COMMAND ${CMAKE_COMMAND}
        -DNPC_MIND=$<TARGET_FILE:npc_mind>
        -DEXAMPLE=${CMAKE_CURRENT_SOURCE_DIR}/../examples/rook.tree
        -DWORK=${CMAKE_CURRENT_BINARY_DIR}/smoke
        -P ${CMAKE_CURRENT_SOURCE_DIR}/smoke.cmake)
