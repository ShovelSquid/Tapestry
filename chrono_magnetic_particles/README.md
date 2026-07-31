# Adaptive Magnetic Particle Simulation (raw C++ / OpenGL compute)

A small experimental simulation with:

- GPU-resident particles updated by an OpenGL 4.3 compute shader.
- Automatic particle-count tuning based on SSBO capacity and measured frame rate.
- A few oriented spherical nodes modeled as magnetic dipoles.
- Dipole-dipole attraction, repulsion, torque, angular velocity, and fast rotation.
- Softened equations and damping for stable real-time visual behavior.

This is deliberately independent of Project Chrono. Chrono::GPU is aimed primarily at GPU granular/DEM simulation; this prototype uses a custom field solver because magnetic dipoles are the central mechanic.

## Build

Requirements: CMake 3.24+, a C++20 compiler, Git, and an OpenGL 4.3-capable GPU/driver.

```bash
cmake -S . -B build
cmake --build build --config Release
```

Run:

```bash
./build/magnetic_particles
```

On Windows with a multi-config generator:

```powershell
.\build\Release\magnetic_particles.exe
```

CMake downloads GLFW, GLAD, and GLM automatically.

## Controls

- `Esc`: quit.
- Camera slowly orbits automatically.

## Platform support

| Platform | Status |
| --- | --- |
| Linux | Works (Mesa or proprietary drivers with GL 4.3) |
| Windows | Works |
| **macOS** | **Builds, but cannot run** |

### macOS will not run this

macOS is a hard blocker, not a configuration problem. Apple's OpenGL
implementation is frozen at **4.1 core** and was deprecated in 10.14; it never
shipped compute shaders (`GL_ARB_compute_shader`, GL 4.3) or shader storage
buffer objects (`GL_ARB_shader_storage_buffer_object`, GL 4.3).

Those two features *are* the architecture here: `src/main.cpp` requests a 4.3
core context, dispatches `particles.comp` via `glDispatchCompute`, and keeps all
particle state GPU-resident in SSBOs. There is no subset of this design that
runs on 4.1.

The build succeeds and then fails at startup:

```
Fatal: OpenGL 4.3 window creation failed
```

That message comes from the `glfwCreateWindow` null check — GLFW cannot satisfy
the 4.3 core hint, so window creation returns null before any GL call happens.
Lowering the version hint does not help; the compute shader will simply fail to
compile instead.

Making this run natively on macOS means replacing the compute backend with
**Metal compute** or **WebGPU** (via Dawn). That is a port, not a patch. See
`web/index.html` for a 2-D browser version that runs anywhere, including macOS.

Full diagnosis, including what was ruled out and why:
[`logs/2026-07-30-macos-opengl-blocker.md`](logs/2026-07-30-macos-opengl-blocker.md).

## Browser version

`web/index.html` is a self-contained 2-D port of the same model — softened
dipole superposition for the field, plus dipole-dipole force and torque between
nodes. No build step and no dependencies; open it directly:

```bash
open web/index.html
```

It is the only way to see this simulation move on macOS.

## Build note: glad2

glad2 has no `CMakeLists.txt` at its repository root — its build system, and the
`glad_add_library` function, live in a `cmake/` subdirectory. `FetchContent` must
be pointed at it explicitly:

```cmake
FetchContent_Declare(glad GIT_REPOSITORY ... SOURCE_SUBDIR cmake)
```

Without `SOURCE_SUBDIR cmake`, configuration fails with
`Unknown CMake command "glad_add_library"`. glad2 also generates its loader at
configure time, so **Python 3 with Jinja2** must be available.

## Important physics note

The node solver uses softened, scaled magnetic dipole equations rather than SI units. It is suitable as a simulation/game prototype, not an engineering-grade electromagnetics solver. Particle motion visualizes the dipole vector field; particles do not currently interact with each other.

## Good next steps

1. Render node orientation arrows and field lines.
2. Add mouse picking and node creation.
3. Replace the all-nodes particle loop with a spatial grid if node count grows.
4. Add CUDA/HIP backend for larger workloads and explicit VRAM querying.
5. Couple node rigid bodies to Project Chrono while keeping the custom GPU field kernel.
