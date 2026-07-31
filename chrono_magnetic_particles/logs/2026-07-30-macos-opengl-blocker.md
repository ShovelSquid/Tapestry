# 2026-07-30 — Build fix and macOS runtime blocker

Environment: macOS 26.5.2 (build 25F84), arm64, CMake 4.4.1, Python 3.9.6 with
Jinja2 3.1.5, glad v2.0.8, GLFW 3.4, GLM 1.0.1.

Two separate problems. The first was a real bug and is fixed. The second is a
platform ceiling and is not fixable without a port.

---

## 1. Configure failure — `glad_add_library` undefined (FIXED)

### Symptom

```
CMake Error at CMakeLists.txt:17 (glad_add_library):
  Unknown CMake command "glad_add_library".
```

### Cause

glad2 has no `CMakeLists.txt` at its repository root. Confirmed against the
fetched source:

```
$ ls build/_deps/glad-src/
LICENSE  MANIFEST.in  README.md  cmake  example  glad
long_description.md  pyproject.toml  requirements.txt  test  utility

$ ls build/_deps/glad-src/CMakeLists.txt
ls: CMakeLists.txt: No such file or directory

$ grep -rn "function(glad_add_library" build/_deps/glad-src/cmake/
cmake/GladConfig.cmake:178:function(glad_add_library TARGET)
```

So `FetchContent_MakeAvailable(glad)` had no directory to add, `GladConfig.cmake`
was never included, and the function did not exist by the time line 17 ran.

### Fix

`CMakeLists.txt` — point FetchContent at the `cmake/` subdirectory:

```cmake
FetchContent_Declare(glad GIT_REPOSITORY https://github.com/Dav1dde/glad.git GIT_TAG v2.0.8
                          SOURCE_SUBDIR cmake)
```

### Verification

Configure and build both succeed:

```
-- Configuring done (39.1s)
-- Generating done (0.1s)
-- Build files have been written to: .../build

[ 10%] Built target glad_gl_core_43
[ 96%] Building CXX object CMakeFiles/magnetic_particles.dir/src/main.cpp.o
[100%] Linking CXX executable magnetic_particles
[100%] Built target magnetic_particles
```

No warnings from `src/main.cpp` under `-Wall -Wextra -Wpedantic`.

Note: glad2 generates its loader at configure time using Python + Jinja2. Both
must be present or configuration fails differently.

---

## 2. Runtime failure — macOS has no OpenGL 4.3 (NOT FIXABLE HERE)

### Symptom

The binary links successfully and then exits immediately:

```
$ ./build/magnetic_particles
Fatal: OpenGL 4.3 window creation failed
exit=1
```

### Cause

Apple's OpenGL implementation is frozen at **4.1 core** and was deprecated in
macOS 10.14. It never shipped:

- `GL_ARB_compute_shader` (core in GL 4.3)
- `GL_ARB_shader_storage_buffer_object` (core in GL 4.3)

Both are load-bearing in this design, not incidental:

| Location | Requirement |
| --- | --- |
| `src/main.cpp:75` | `GLFW_CONTEXT_VERSION_MAJOR 4` / `MINOR 3`, core profile |
| `src/main.cpp:82` | `glGetInteger64v(GL_MAX_SHADER_STORAGE_BLOCK_SIZE, ...)` |
| `src/main.cpp:97-98` | Particle and node state in `GL_SHADER_STORAGE_BUFFER` |
| `src/main.cpp:103` | `program({{GL_COMPUTE_SHADER, "particles.comp"}})` |
| `src/main.cpp:120` | `glDispatchCompute` + `glMemoryBarrier` |

The failure happens at `glfwCreateWindow`, before any GL call — GLFW cannot
satisfy the 4.3 core hint and returns null.

### What does not work

- **Lowering the context hint to 4.1.** The window would open, then
  `particles.comp` would fail to compile. The SSBO calls would also be invalid.
- **Requesting a compatibility profile.** macOS offers only 2.1 legacy or
  3.2-4.1 core. Neither has compute shaders.
- **Software fallback.** No Mesa llvmpipe path is wired up, and it would be far
  too slow for this workload.

### What would work

A real port of the compute backend:

1. **Metal compute** — closest to the current model. `particles.comp` maps fairly
   directly onto a Metal compute kernel with `MTLBuffer` in place of SSBOs.
2. **WebGPU via Dawn** — portable across macOS/Linux/Windows, keeps one backend.
3. **CUDA/HIP** — already listed in the README roadmap, but does not help on
   macOS specifically.

### Interim

`web/index.html` is a self-contained 2-D browser port of the same physics
(softened dipole superposition, dipole-dipole force and torque, node angular
velocity and damping). It runs on macOS. Measured 60 fps at 9,000 particles and
35 fps at 40,000 particles with 7 dipoles.

---

## Status

- Linux / Windows: unaffected by either issue. The glad fix helps both.
- macOS: builds, cannot run. Use `web/index.html` or port the compute backend.
