cmake_minimum_required(VERSION 3.24)
project(chrono_magnetic_particles LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

include(FetchContent)
set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
FetchContent_Declare(glfw GIT_REPOSITORY https://github.com/glfw/glfw.git GIT_TAG 3.4)
FetchContent_MakeAvailable(glfw)

# glad2 has no CMakeLists.txt at its repo root; the build system (and the
# glad_add_library function) lives in the cmake/ subdirectory.
FetchContent_Declare(glad GIT_REPOSITORY https://github.com/Dav1dde/glad.git GIT_TAG v2.0.8
                          SOURCE_SUBDIR cmake)
FetchContent_MakeAvailable(glad)
glad_add_library(glad_gl_core_43 REPRODUCIBLE API gl:core=4.3)

FetchContent_Declare(glm GIT_REPOSITORY https://github.com/g-truc/glm.git GIT_TAG 1.0.1)
FetchContent_MakeAvailable(glm)

add_executable(magnetic_particles src/main.cpp)
target_link_libraries(magnetic_particles PRIVATE glfw glad_gl_core_43 glm::glm)
target_compile_definitions(magnetic_particles PRIVATE SHADER_DIR="${CMAKE_CURRENT_SOURCE_DIR}/shaders")

if(MSVC)
  target_compile_options(magnetic_particles PRIVATE /W4 /permissive-)
else()
  target_compile_options(magnetic_particles PRIVATE -Wall -Wextra -Wpedantic)
endif()
