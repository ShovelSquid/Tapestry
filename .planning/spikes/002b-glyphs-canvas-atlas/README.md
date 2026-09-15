---
spike: 002b
idea: thread-rendering
name: glyphs-canvas-atlas
type: comparison
validates: "Given letters along the thread, when drawn with a canvas texture atlas and instanced quads (no text library) along the z-axis and from the side, then text is crisp at all zooms"
verdict: WINNER
related: [001, 002a]
tags: [webgl, text, instancing, atlas]
---

# Spike 002b: Glyphs from a Canvas Atlas (instanced quads, no text library)

## What This Validates
**Given** the thread's keystroke letters (Verdana, 0.12 world units per em) placed one per keystroke along the thread in the repo's Electron on Kaelen's M4 MacBook Air,
**when** drawn from a 16 × 6 atlas of 128 px cells that the browser renders into a canvas, as one instanced quad per letter (position + character code) in a single draw call, with mipmaps and maximum anisotropic filtering,
**then** letters are legible in the live view, an oblique view and side views from 8 to 120 px per em, while holding 60 fps with 1 h (4.8 k letters) and 8 h continuous (78 k letters) of history.

## Research
- No text library. The browser draws Verdana into a canvas once via `FontFace`; three.js 0.186.0 uploads it as a `CanvasTexture` with `LinearMipmapLinearFilter` and max anisotropy.
- Each letter costs 16 bytes of GPU data: a `vec3` position and a `float` character code. The quad's orientation is one uniform, matching the troika planes' `rotation.y` in 002a.
- The spike 001 trap applies: three.js uploads only update ranges when any exist, so a live keystroke adds a range only when no full upload is pending.

| Approach | Tool | Pros | Cons |
|---|---|---|---|
| **Canvas atlas + instanced quads** | none | One instance per letter, flat cost, trivial build | Blurs when magnified past the 128 px cell; ASCII only as built |
| SDF text per keystroke | troika (002a) | Sharp at any size | Per-letter objects: memory and per-frame cost explode (002a) |
| MSDF atlas + instanced quads | msdf tooling (not built) | Sharp at any size with this design | Offline atlas generation step, more shader work |

## How to Run
From the repo root (after `cd .planning/spikes && npm install`):
```sh
node_modules/.bin/electron .planning/spikes/002b-glyphs-canvas-atlas/main.cjs            # interactive: type, 1–8 views, S sweep, L 1 h / 8 h
node_modules/.bin/electron .planning/spikes/002b-glyphs-canvas-atlas/main.cjs --shots    # 8 views → results/shots/
node_modules/.bin/electron .planning/spikes/002b-glyphs-canvas-atlas/main.cjs --bench    # 1 h and 8 h continuous benchmark
node_modules/.bin/electron .planning/spikes/002-shared/compare.cjs                        # side-by-side with 002a
```

## What to Expect
The same scene as 002a: white Verdana letters above a grey thread line, in live, oblique and side views. Letters are very slightly softer than 002a when large.

## Investigation Trail
1. **Screenshots (1 h), compared crop by crop with 002a:**
   - **Live and oblique:** legible; the nearest large letters are slightly softer than SDF.
   - **Side, 8, 12, 16 and 24 px:** nearly indistinguishable from 002a. "ime, one letter" reads cleanly even at 8 px, so mipmaps and anisotropy handle minification well.
   - **Side, 48 px:** slightly soft.
   - **Side, 120 px:** visibly blurred edges. Each 128 px cell holds about 79 px per em, magnified here to 240 device pixels.
2. **Benchmark with typing on:** 60 fps and 0 dropped frames in every view at both 1 h and 8 h continuous. Build is under 50 ms even for 78 k letters. Private memory is 42–50 MB, the same as an empty scene.
3. **No mipmap bleeding was visible** between atlas cells at any tested size. It might appear on very small letters in the far distance of the live view, but that's below what anyone reads.

## Results
**Verdict: WINNER** of 002. It's the approach for thread letters. The one caveat is sharpness when magnified.

| Load | View | fps | Dropped | Build | Private memory |
|---|---|---|---|---|---|
| 1 h (4.8 k letters) | live / oblique / side 16 px / sweep 4→120 px | 59.9 | 0 % | <0.05 s | 42–44 MB |
| 8 h continuous (78 k letters) | live / oblique / side 16 px / sweep 4→120 px | 59.9 | 0 % | <0.05 s | 42–50 MB |

### Head-to-head: 002a (troika SDF) vs 002b (canvas atlas)
| | 002a troika SDF | 002b canvas atlas |
|---|---|---|
| Legibility at 8–24 px (side) | ✓ | ✓, indistinguishable |
| Sharpness at 48–120 px | **✓ razor-sharp** | ⚠ soft at 48 px, blurred at 120 px |
| Live and oblique views | ✓ crisp | ✓, nearest letters slightly soft |
| 1 h: fps / memory | 60 / 140 MB | 60 / 43 MB |
| 8 h continuous: fps / memory | **✗ 4–5.5 / 850 MB** | **✓ 60 / 42–50 MB** |
| Build at 8 h | 2.7 s | <0.05 s |

**Signal for the build (Phase 2.3):**
- **Draw thread letters as instanced quads from a glyph atlas in one draw call**, next to the procedural thread ribbon from spike 001. Cost stays flat to at least 78 k letters.
- **If magnified letters must stay sharp**, and the side view probably zooms that far, swap the canvas bitmap for an **SDF or MSDF atlas in the same instanced design**. The quads, instance data and draw call stay the same; only the texture and fragment shader change. troika's SDF generator (`webgl-sdf-generator`) or an offline MSDF tool can produce it. That's a small follow-up spike.
- **Unicode:** this atlas holds printable ASCII only. Real notes need emoji and non-Latin scripts, so the build needs a dynamic atlas that adds glyphs on first use (with paging), and grapheme-aware keystroke records. Not tested.
- Reading long passages still belongs in the DOM text window above the thread. The WebGL letters are for spatial context.
