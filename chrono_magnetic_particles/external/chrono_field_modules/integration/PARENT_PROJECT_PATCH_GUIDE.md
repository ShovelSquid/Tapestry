# Parent Project Patch Guide

In the existing `src/main.cpp`:

1. Add the `living_field` library with `add_subdirectory(path/to/chrono_field_modules)` and link `living_field`.
2. Replace each node's unconstrained `angularVelocity` drive with a `SpinProgram`.
3. Before uploading nodes each frame, call `SpinController::apply(node, simulation_time, dt)`.
4. Convert the result with `to_gpu(node)` and upload the magnetic axis plus dipole moment.
5. Keep the current GPU particles as tracers. They should not be included in force feedback.
6. Add a separate, small `ResponsiveParticle` collection only when testing material self-organization.
7. For Chrono integration, disable `step_rigid_nodes` and feed `DipoleField::interaction` forces and torques into Chrono bodies.

Minimal CMake integration:

```cmake
add_subdirectory(external/chrono_field_modules)
target_link_libraries(magnetic_particles PRIVATE living_field)
target_include_directories(magnetic_particles PRIVATE external/chrono_field_modules/integration)
```
