# 0002 — Determinism, numbers and implementation language

**Date:** 2026-10-04
**Status:** Decided, except where marked *open*
**Spec impact:** `narrative-engine-core-spec.md` gains §8.4 and §13. Open question §12.1 is resolved.

## Questions

1. How important is numeric representation?
2. If replay is exact, are snapshots needed at all, or do we store only inputs?
3. How much complexity does determinism add?
4. Should the core be written in Rust? Where would it run, and how much has to be platform-specific?

## Context

- The spec requires deterministic simulation (principle 8).
- The physics ambitions are growing, for example a watercolor brush whose bristles carry ink and water, painting splats that then settle, spread and seep. That is fluid-like simulation, which pushes toward GPU parallelism.
- The earlier `semantic-world` prototype and `physics-engine` work are in C++.

## Decisions

### Store inputs, not outputs

The `.tree` history stores **keys and rules**. The world is recomputed from them. This depends on exact determinism. Without it, outputs would have to be stored, files would grow very large, and upstream edits could not be replayed reliably.

### Numbers

- **Simulation math uses deterministic IEEE floats**, not fixed-point by default. IEEE 754 requires `+ − × ÷ √` to be correctly rounded, so they are identical on every platform. Cross-platform drift comes from other sources, and those are banned:
  - fused multiply-add contraction and fast-math;
  - platform math libraries for `sin`, `cos`, `exp` and similar (use the pure-Rust `libm` crate instead);
  - unordered parallel reductions;
  - iteration over hash maps (use `BTreeMap` or `IndexMap`);
  - GPUs for authoritative simulation.
- **Key times are exact rationals.** Unbounded subdivision of spans needs exact positions. This is bookkeeping, not heavy math.
- **Nested frames keep float values local and small**, which is where floats are most precise.
- **Fixed-point is a per-rule fallback** if a particular rule needs it.

### Snapshots are a cache

- They are still needed for performance. Scrubbing deep into a story would otherwise mean re-simulating everything before that point.
- They can be deleted and regenerated, and are **verified by state hash**. They are never authoritative.
- Files can be shared without snapshots, which are rebuilt on load.

### Rule versions are part of the history

The same inputs only give the same outputs if the rules are the same. The history records **which version of each rule** produced it, so that old stories replay identically after rules change. This is the "replay/version contract for plugin behavior" from PROJECT.md.

### Baked rules (escape hatch)

Some rules may be too expensive to make deterministic, typically GPU fluid simulation. These can be marked **baked**: their outputs are stored like a Blender simulation cache. They remain scrubbable, but they are stored rather than recomputed. A GPU can also run a *live preview* while the CPU computes the authoritative result.

### Language: Rust

Reasons:
- Rust never fuses `a*b + c` into FMA implicitly and has no fast-math by default, which removes a major source of drift that C++ compilers introduce silently.
- Dimforge's Rapier (with `enhanced-determinism`), parry and nalgebra give cross-platform deterministic physics and geometry.
- WebAssembly is a first-class target. **Plugin rules compiled to WASM run sandboxed and deterministically**, which suits a plugin-defined rule system that must still replay exactly.
- The ID-based design (points, keys and rules referring to each other by ID) suits Rust's arena and slotmap patterns and avoids borrow-checker friction.

Costs accepted:
- Learning curve.
- The C++ `semantic-world` prototype becomes reference material rather than a code base to build on.

### Architecture layers

```
core/     points, frames, keys, rules, simulation, gap report
          no I/O, no required threads, no GPU — zero platform code
render/   splat renderer on wgpu (Vulkan / Metal / DX12 / WebGPU) — almost entirely shared
hosts/    per-platform shells: windowing, files, packaging, stylus input
```

The core's purity is the important constraint. It also lets the same story be run on x86, ARM and WASM with hashes compared in automated tests.

### Platform reach

| Target | Status |
|---|---|
| Linux, Windows, macOS | First-class |
| ARM Linux (Raspberry Pi, Linux on Switch) | First-class |
| iOS, Android | Supported; needs a native app shell |
| Browser (WASM) | First-class; threads need cross-origin-isolation headers, and memory is capped at 4 GB |
| Unity | Native plugin through a C interface |
| Retail Switch (Nintendo SDK) | Unofficial and under NDA; not counted on |

## Open

- **First host: not yet decided.** The web is the **recommended** first host. Browser Pointer Events give stylus pressure and tilt uniformly across devices, while native platforms each have their own pen API (Windows Ink, Apple Pencil, Wayland tablet). That matters for brush-based painting. The decision is deferred.
- **Rust toolchain** is not yet installed on the development machine.

## Rejected

- Fixed-point as the default numeric representation, since it costs too much for the benefit.
- Storing simulation outputs as the source of truth, except for rules explicitly marked baked.
- Continuing the core in C++.
