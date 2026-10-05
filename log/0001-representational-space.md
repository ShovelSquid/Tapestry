# 0001 — A representational space

**Date:** 2026-10-04
**Status:** Decided → recorded in `narrative-engine-core-spec.md` v0.1
**Log entries are never edited after commit. Later changes get a new entry.**

## Starting question

A central part of Tapestry is a narrative engine: write a story and see it played back in a 2D/3D world you can shape, film, light and scrub. Its core is taking words, extracting meaning, and placing that meaning into a spatial reality where points can refer to abstract concepts. Three things needed defining:

1. How the spatial reality works.
2. How meaning is extracted from text and placed into it.
3. How gaps in the spatial reality and the text are arranged and filled.

This entry covers (1) and the engine side of (3). Extraction and gap-*filling* were deferred.

## How the idea evolved

1. **Text → score → performance.** The first proposal put an intermediate story representation between text and world, so that both are views of it. The world was layered into semantic, staging and direction layers.
2. **Narrowed to the simulation.** The user reframed the core as a *representational space*: points in 3D that store semantic data, with values that change over time. Narrative time (order of telling) was set aside to focus on simulation time.
3. **Semantic Gaussian splatting.** Each object is one semantic point, with child splats (ellipsoids) defining its exact shape. Parts are semantic points too, which gives recursion and level of detail: the coarsest object is one ellipsoid.
4. **Body vs aura → dissolved.** Auras (light, sound, meaning) were first proposed as separate from bodies. The user asked what separates an aura from another body attached to a different part. Answer: nothing. Everything is points with properties, and behavior comes from rules. Physics on splats allows deformable, blob-like matter (cf. PhysGaussian).
5. **Meaning follows rules like physics.** One rule system, not two.
6. **Art-directed simulation.** First proposal: keys pull the simulation toward targets, and "strain" measures cheating. **Rejected by the user** in favor of strict causality: nothing changes without a cause (Newton's first law, applied to meaning too). Keys describing outcomes are *checked*, not enforced. A missing cause becomes a question ("what made the cup fall?"), and the answer becomes a cause that feeds the simulation.
7. **The engine is neutral.** The user rejected the engine judging what is interesting: "gaps are gaps." Any detail can be the meat of a story (the David Foster Wallace example: fifteen pages about two steps). Interest belongs to companions and users. Deleting and reauthoring keys is core to storytelling.
8. **Infinite, unitless time.** Time is a continuum that can be expanded indefinitely. Units are arbitrary, and a blank default is acceptable. This led to nested local frames for both time (spans) and space.
9. **Ordering resolves like gaps.** "Before" means before; the exact time is unknown until provided. Filling gaps (by users or companions) is deferred until the core is resolved.

## Decisions

- Everything is **points** (with properties and hierarchy) in **nested frames** of space and time.
- All authoring is **keys**: cause, state or rule. Keys can be placed in time or only ordered.
- **Rules** are deterministic and identical in form for physics and meaning.
- **Causality is strict.** State keys are checked; mismatches are reported as unexplained changes.
- **Unspecified ≠ changed.** Filling in a value nobody had stated needs no cause.
- The engine **reports gaps and never ranks or fills them**.
- Space and time are **unbounded in detail and unitless by default**.

## Rejected

- Keys acting as forces or pulls toward target states (the "strain" approach).
- The engine prioritizing gaps by importance.
- A fixed default unit of time.
- Aura as a separate kind of thing from body.
