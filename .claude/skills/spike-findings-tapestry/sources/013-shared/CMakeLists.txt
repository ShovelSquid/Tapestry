cmake_minimum_required(VERSION 3.24)
project(story_compare LANGUAGES C CXX)

set(TAPESTRY_BUILD_APP OFF CACHE BOOL "" FORCE)
set(TAPESTRY_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(TAPESTRY_BUILD_RENDER OFF CACHE BOOL "" FORCE)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../../tapestry tapestry)

set(SPIKES ${CMAKE_CURRENT_SOURCE_DIR}/..)
add_executable(story_compare
    compare.cpp
    ${SPIKES}/012-npc-mind-kernel/NpcMind.cpp
    ${SPIKES}/013a-per-npc-worlds/PerNpc.cpp
    ${SPIKES}/013b-shared-story-world/Story.cpp)
target_include_directories(story_compare PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${SPIKES}/012-npc-mind-kernel
    ${SPIKES}/013a-per-npc-worlds
    ${SPIKES}/013b-shared-story-world)
target_link_libraries(story_compare PRIVATE tapestry_kernel)

enable_testing()
add_test(NAME story_compare_verify COMMAND story_compare verify ${CMAKE_CURRENT_BINARY_DIR}/verify)
