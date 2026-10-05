# 0004 — Authority and appearance

**Date:** 2026-10-05
**Status:** Decided
**Spec impact:** new principle 10, new §8.5, new open question §12.8.

## Context

The watercolor brush (bristles carrying water and pigment, simulated flow, blooms, edge darkening, granulation) showed a tension. A deterministic CPU simulation can be slower than real time for large wet areas, while a GPU can simulate it instantly. The user liked the idea of the GPU rendering quickly and then "settling" into the CPU's result, and saw a render style on top of an authoritative simulation as core, with neural rendering possible later.

## Decision: authority vs appearance

**The authoritative simulation decides what happens. Everything else decides only how it looks.**

| | Authority | Appearance |
|---|---|---|
| Runs on | CPU, deterministic | GPU, neural models, anything |
| Can depend on the view | Never | Freely |
| Exact and repeatable | Required | Not required |
| Examples | rules, gap report | GPU preview simulation, render levels, styles, neural rendering |
| Feeds back into the world | Yes | **Never** |

### Preview, then settle

- The GPU runs a **preview simulation** and shows the result immediately.
- The CPU computes the **authoritative** result just behind it. When that result arrives, the view blends into it.
- Areas that haven't settled yet may be subtly marked.
- The lag is proportional to how much is being simulated. For watercolor, that's how much paper is wet.

### Two kinds of level of detail

- **Simulation detail is authored.** Grid resolution, bristle count and substeps are properties of points or rules. Changing one is an edit and produces a different result. It can never depend on zoom or view, or looking at the world would change it.
- **Rendering detail depends on the view**, and can change freely:

| Level | Draws | Cost |
|---|---|---|
| L0 Semantic | each point as a blob or glyph | thousands of points at 60 fps on any device |
| L1 Proxies | parts and rough shapes | very cheap |
| L2 Splats | full Gaussian splat rendering | millions in real time on a desktop GPU |
| L3 Material | pigment optics (Kubelka–Munk / Mixbox-style mixing), paper texture, wet sheen, glazing | moderate |
| L4 Final | path-traced frames for exported sections | seconds to minutes per frame, offline |

### Styles

- Render styles (watercolor, noir, photoreal, neural) are appearance. The same story and simulation can be filmed in any of them.
- **Styles can read meaning, not just geometry.** For example, a style can render high `dread` regions differently.
- Neural rendering fits here and can never change the story.

## Watercolor specifics recorded

- **Paint on a surface:** fields in the surface's own frame, following Curtis et al. 1997: surface water, suspended and deposited pigment, capillary water in the fibers.
- **Paint in open air:** splat particles. This is invented physics, not simulation of a real medium.
- **Only wet tiles are simulated.** Dry tiles sleep.
- **Dried pigment** is stored as texture layers in the surface's frame rather than as splats.

## Open

- **Painting on the preview.** The user paints each stroke based on the preview, but the stroke is applied to the authoritative state. If the authoritative bloom spread differently, the stroke lands on a slightly different wet pattern than the one the user saw. The difference is usually small and shrinks as the CPU keeps up, but it is real.
- **Fixed-point GPU simulation** that is deterministic across vendors could remove the split for grid simulations. Untested.
