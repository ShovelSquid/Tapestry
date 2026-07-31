cmake_minimum_required(VERSION 3.24)
project(chrono_field_modules LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
option(LIVING_FIELD_BUILD_EXAMPLES "Build standalone examples" ON)
add_library(living_field STATIC
  src/spin_controller.cpp src/dipole_field.cpp src/rigid_coupling.cpp
  src/field_sampler.cpp src/responsive_particles.cpp src/target_volume.cpp
  src/frequency_optimizer.cpp src/training_log.cpp src/command_protocol.cpp
  src/spherical_shape.cpp)
target_include_directories(living_field PUBLIC include)
if(MSVC)
  target_compile_options(living_field PRIVATE /W4 /permissive-)
else()
  target_compile_options(living_field PRIVATE -Wall -Wextra -Wpedantic)
endif()
if(LIVING_FIELD_BUILD_EXAMPLES)
  foreach(name spin_frequency dipole_pair field_volume responsive_matter optimize_frequency text_command spherical_shape)
    add_executable(example_${name} examples/${name}.cpp)
    target_link_libraries(example_${name} PRIVATE living_field)
  endforeach()
endif()
