# Living Field Modules

A clean, independent C++20 add-on for the magnetic-particle project. Each idea is isolated so it can be tested before integration with OpenGL, Project Chrono, or an AI model.

## Modules

- `spin_controller`: exact frequency in Hz, phase, axis, sweeps, smooth frequency slew.
- `dipole_field`: SI-scaled point-dipole field, force, and torque.
- `rigid_coupling`: small-node rigid integration; replace with Chrono in production.
- `field_sampler`: samples the actual 3D vector field without display particles.
- `responsive_particles`: physical magnetic matter responding to the field; optional source conversion for feedback experiments.
- `target_volume`: density goals such as a bridge between nodes.
- `frequency_optimizer`: isolated inverse-control search interface.
- `training_log`: JSONL records for later neural-controller training.
- `command_protocol`: strict text-to-simulation command parser.
- `spherical_shape`: animated particle surfaces using spherical-frequency terms.
- `integration/`: thin adapter examples for Chrono and the existing OpenGL SSBO.

## Build

```bash
cmake -S . -B build
cmake --build build -j
ctest --test-dir build
```

Run examples from the build directory, such as `./example_spin_frequency`.

## Accuracy boundaries

This starts with magnetoquasistatic point dipoles. It is physically scaled but not a finite-element Maxwell solver. Point dipoles become inaccurate near or inside finite magnets. Particle feedback is deliberately explicit and expensive; use grids/FMM/Barnes-Hut before scaling it. The code uses doubles on CPU and converts to floats only for GPU rendering.

## Suggested parent-project order

1. Replace the old free angular velocity with `SpinController`.
2. Upload `magnetic_axis` through `GpuMagneticNode`.
3. Render `field_sampler` results independently of particles.
4. Add responsive particles in small counts first.
5. Use `frequency_optimizer` to generate training records.
6. Train a policy model on state + goal -> frequency/phase program.
