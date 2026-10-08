# Tapestry core

The Rust workspace for the narrative engine. The design lives on the `ws/writing` branch
(`narrative-engine-core-spec.md` and `log/`).

```
crates/view     WorldView: the boundary. "Every point, at time t." Depends on nothing of ours.
crates/mock     A hand-keyed cup scene (spec §10) standing in for the core. Not simulated.
crates/render   L0 renderer: one ray-cast ellipsoid per point, drawn offscreen with wgpu.
apps/viewer     Window, timeline scrubber, keys and gap report (eframe/egui). Paused for now.
apps/bake       Samples a WorldView into JSON for hosts, keeping only frames where something changes.
blender/        Blender 5.2 add-on: runs tapestry-bake and plays the result as native animation.
```

**The one rule:** everything that shows the world (`render`, `viewer`, `bake`, and through it
Blender) sees it only through `tapestry-view`. When the real
core arrives it implements `WorldView`, replaces the mock, and nothing downstream changes
(spec principle 10, authority vs appearance).

## Blender (the main host for now)

Blender is appearance only. It runs the core as a separate program and plays back what it
writes. Blender keyframes are a regenerable cache of the world's history, not Tapestry keys:
editing them doesn't change the story.

1. `cargo build --release -p tapestry-bake`
2. Link the add-on: `ln -s $PWD/blender/tapestry ~/.config/blender/5.2/extensions/user_default/tapestry`
3. In Blender: Preferences → Add-ons → enable **Tapestry**.
4. 3D View sidebar (N) → **Tapestry** → **Rebake**. Keys appear as timeline markers.

Each point becomes an object parented like the point, so nested frames are Blender's parent
hierarchy. Blobs are meshed once and only moved. The world is Y-up; a `Tapestry` root empty
turns it Z-up.

## Run

```sh
cargo run -p tapestry-viewer                                      # the window
cargo run -p tapestry-render --example snapshot -- out 35.5 40    # headless PNGs at given times
cargo test
```

Viewer: drag to orbit, right-drag to pan, scroll to zoom, space to play. Hover a key on the
timeline to read it.
