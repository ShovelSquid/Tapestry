# Spike Wrap-Up Summary

**Date:** 2026-09-15
**Idea:** thread-rendering
**Spikes processed:** 11 (of 13 in the manifest; 009 and 010 were proposed and never run)
**Feature areas:** thread geometry and load · glyph rendering · editor and app integration · persistence and replay · navigation and feel
**Skill output:** `./.claude/skills/spike-findings-tapestry/`

## Processed Spikes

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 001 | thread-stream-load | standard | ✓ VALIDATED | Thread geometry and load |
| 002a | glyphs-sdf | comparison | ✗ INVALIDATED | Glyph rendering |
| 002b | glyphs-canvas-atlas | comparison | ✓ WINNER of 002 | Glyph rendering |
| 003a | sharp-glyphs-sdf | comparison | ⚠ PARTIAL | Glyph rendering |
| 003b | sharp-glyphs-msdf | comparison | ✓ WINNER of 003 | Glyph rendering |
| 004 | typer-over-live-thread | standard | ✓ VALIDATED | Editor and app integration |
| 005 | thread-in-real-app | standard | ✓ VALIDATED | Editor and app integration |
| 006 | record-redraw-roundtrip | standard | ⚠ PARTIAL | Persistence and replay |
| 007 | hybrid-glyph-worker | standard | ⚠ PARTIAL | Glyph rendering |
| 008 | scrub-to-any-moment | standard | ✓ VALIDATED | Persistence and replay |
| 011 | navigation-feel | standard | ✓ VALIDATED | Navigation and feel |

## Key Findings

**The thread renders.** A procedural ribbon — sessions and keystrokes stored, dots drawn from time × speed in a fragment shader — holds 59.9 fps with zero dropped frames at 8 h continuous (1.73 M dots, 78 k letters) in 0.9 MB of GPU buffers and under 55 MB of memory. One GPU point per dot was invalidated beyond about an hour, on rasterization and overdraw rather than vertex count.

**Letters are instanced quads from one atlas.** One text object per keystroke was invalidated outright (4–5.5 fps, 850 MB at 78 k letters). The atlas itself took three spikes to settle: a canvas bitmap is fast but blurs above 48 px; a browser-derived SDF is fast and Unicode-complete but ripples at 120–240 px; MSDF from font files is razor-sharp but costs ~8 ms per glyph, worst 22.6 ms. Spike 007's hybrid resolves it — show the cheap cell in 0.5 ms, swap in the worker-generated MSDF cell ~15 ms later for 0.1 ms — so D-19's sharpness never touches a frame.

**The real editor over a live thread is not a performance problem.** Key → painted is 8.7–9.1 ms median and 16.9 ms worst at twice a fast typist's speed with 8 h of history on screen, and the editor's own work is 0.3 ms per keystroke. Inside the app's own React canvas with real NoteCards, every phase matched the canvas-only baseline, and twenty open/close cycles leaked no WebGL context.

**Storage round-trips exactly, and reveals a kernel problem.** Keystrokes written as ordinary `.tree` `set` properties come back identical and readable in a text editor at every commit window tested. But reopening is quadratic in commit count — `Kernel::fromJournal` copies the whole world once per commit — so an 8 h thread takes 23 s to open at D-06's ⅓ s commits and 237 ms at 5 s. Threads are the first feature to make a pre-existing kernel cost visible; the commit window is a lever, not the fix.

**Scrubbing and navigation are comfortable.** Rebuilding the document at any past moment from snapshots costs 0.2 ms median against 3.6 ms naive, and a 300-step drag held 60 fps. Zoom expressed as a span in seconds held 60 fps from 8 hours down to 0.25 s across stills, sweeps, pans, flights and a whole-history scrubber drag.

## What Is Still Open

- **Kernel copy-per-commit** makes opening any world quadratic. Candidates: apply ops to the live world with an undo log, or copy only the nodes a commit touches.
- **Atlas paging.** LRU eviction thrashes past 1024 cells and evicted letters vanish. Candidates: a second atlas page, a larger atlas, or evicting only cells with no visible instances.
- **Two human verification checkpoints** remain unanswered in the spike READMEs: input-method composition (004) and whether the navigation gravity feels right (011).
- **Two spikes proposed, never run:** 009 (deleted letters staying legible, D-03/D-04) and 010 (two twisted author strands, D-21). D-21 also needs a per-instance colour channel that the shared glyph shader does not yet have (found in 005).
- **Not covered anywhere:** 120 Hz displays, slower machines, threads longer than 8 h, more than one thread in a world, and concurrent writers.

## Housekeeping

Spike 005's frontmatter still read `verdict: PENDING` while its own Results section and `MANIFEST.md` both recorded VALIDATED. Corrected to `VALIDATED` during this wrap-up.

---

# Spike Wrap-Up Summary: npc-minds

**Date:** 2026-09-30
**Idea:** npc-minds (Perihelion's NPC minds on Tapestry worlds)
**Spikes processed:** 4 (012, 013a, 013b, 014)
**Feature areas:** NPC minds and the story world · the mind bridge
**Skill output:** `./.claude/skills/spike-findings-tapestry/` (appended: `references/npc-minds-story-world.md`, `references/npc-mind-bridge.md`, `sources/012–014`)

## Processed Spikes

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 012 | npc-mind-kernel | standard | ✓ VALIDATED | NPC minds and the story world |
| 013a | per-npc-worlds | comparison | ⚠ PARTIAL | NPC minds and the story world |
| 013b | shared-story-world | comparison | ✓ WINNER of 013 | NPC minds and the story world |
| 014 | mind-bridge | standard | ✓ VALIDATED | The mind bridge |

## Key Findings

**The kernel carries NPC minds unchanged.** Plugin node types are enough: facts, opinions with `because` reasons, voice samples and spoken lines, with the commit's actor recording who changed what (designer, world, mind-sim, speaker). Submit stays at 0.16 ms, and reopening is linear, 745 ms at 55k commits. Commit `7fed53f` fixed the quadratic reopen spike 006 measured, and the thread-rendering risk list has been corrected to say so.

**Author one shared story world; ship slices.** A `believes` edge carries confidence and source, and canon sits on the fact, so one fact can be held differently by many characters and a character can be confidently wrong (Ines and Oda believe a rumor canon calls false). Every context packet was identical three ways (96/96, and again after a correction). Exported per-NPC slices were byte-identical to hand-built per-NPC files. A correction is 1 commit, against 3 commits in 3 files matched by old text.

**Both first query designs were quadratic.** Asking the world edge by edge per node took 1.35 s at 5k lines, and scanning every node while searching the speaker's edges took 2.7 s at 50k. The fixes: index edges in one pass, walk outward from the speaker, and keep the index live in the owning process.

**A dependency-free bridge works.** A Node sidecar on the app's kernel addon, with a live mirror updated from each accepted commit, serves a packet in 1.2 ms over HTTP at 5k lines. Its JS packets equal the C++ ones (240/240). Bursts of 60 simultaneous reads and writes leave the journal Ok and the mirror equal to a reload.

**Landmines.**
- A torn or hand-edited `.tree` opens silently with only its verified prefix, so an NPC would forget without error. Check `status()` before speaking.
- The journal lock allows one writer, so the game and the Tapestry app can't both own a story file.
- The addon doesn't link on Linux without position-independent code.

**Still open.** The local-model spike (mind-sim and speaker roles) on Kaelen's Mac, and the hand check on whether the loop feels like conversation. The design question is whether the companion phases (6–7) share this story schema.

---

# Spike Wrap-Up Summary: generative-vectors

**Date:** 2026-09-30
**Idea:** generative-vectors (Kaelen's "Generative Vector Neural Rendering" note)
**Spikes processed:** 4 (015, 016a, 016b, 017)
**Feature areas:** generative vectors · surfaces from vectors
**Skill output:** `./.claude/skills/spike-findings-tapestry/` (appended: `references/generative-vectors-growth.md`, `references/vector-surfaces.md`, `sources/015–017`)

## Processed Spikes

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 015 | generative-vectors | standard | ✓ VALIDATED | Generative vectors |
| 016a | sdf-surface-nets | comparison | ✓ WINNER of 016 | Surfaces from vectors |
| 016b | swept-tubes | comparison | ⚠ PARTIAL | Surfaces from vectors |
| 017 | fast-sdf | standard | ⚠ PARTIAL | Surfaces from vectors |

## Key Findings

**A few vectors and rules grow a legible object, and it behaves like data.** Three seeds, two knots and a 457-byte description grow 3,765 vectors (×527). The growth is:
- deterministic: Node and Chromium hash the same
- additive: level N+1 never moves level N
- independent of visiting order
- local: a region grown alone is bit-identical to the whole expansion there

Every claim has a negative control that makes it fail. Relationships generate structure: two stalks with one `attract` knot grow into an arch, and nudging one seed reorganises the crown.

**The surface is a field of the vectors.** A smooth union of capsules, meshed with marching tetrahedra on a global lattice, welds forks into fillets and is watertight at every level. It rebuilds identically, and a region lands exactly on the whole surface's vertices. Surface nets was a dead end (33–257 non-manifold edges), and swept tubes only fix seams along a limb (forks overlap).

**Fast by not visiting empty space.** A narrow band of bricks, culled by the field's Lipschitz bound, with dense per-brick corners and per-brick capsule lists, builds the bit-identical mesh 4–11× faster: tree L4 in 0.32 s, level 7 in 1.1 s, a region in tens of milliseconds.

**Two silent index bugs, each caught only by an independent twin.** Spike 015's grid keys past 2⁵³ doubled forces, and 016a's capsule buckets were padded one radius short, so its field depended on the bucket grid. Neither was visible to the spike's own determinism or regional tests.

**Still open.**
- The neural half: inferring seeds and knots, probably from data-drawing's pen strokes first.
- Surface cost: workers, normals through the per-brick lists, the GPU or WASM.
- Bulging rings where a branch meets its continuation.
- Determinism across engines beyond V8.
- Kaelen's hand check on the look and feel.

---

# Spike Wrap-Up Summary: generative-vectors, spike 018

**Date:** 2026-09-30
**Spikes processed:** 1 (018)
**Feature area:** pen strokes as seeds (`references/strokes-as-seeds.md`)

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 018 | strokes-as-seeds | standard | ✓ VALIDATED | Pen strokes as seeds |

## Key Findings

**data-drawing's action list is a sufficient input to generative vectors.**
- The plane frame per stroke gives 3D, pressure gives radius, and the brush gives the role: ink stems, lead anchors, clay mass, and rust strokes as drawn relationships (knots).
- Speed: 6 strokes become 9 seeds, then 361 vectors, then 127k triangles, 0.2 s after pen-up.
- Determinism: strokes drawn by pointer in Chromium replay in Node to identical vector and mesh hashes.
- Fidelity: fitting at a tolerance of about one voxel (0.05) keeps every sample within 0.05 of the chain; 0.18 flattened the drawing.
- Stable ids: seeds are named by stroke ordinal, so appending strokes never changes earlier seeds.
- Edit reach: an edit reaches exactly the strokes related to it by knots or proximity, and 0 vectors elsewhere.

Still open: a learned model for roles and knots, fusing two views into one 3D stem (spike 019, next), and Kaelen's real-pen hand check.

---

# Spike Wrap-Up Summary: generative-vectors, spike 019

**Date:** 2026-09-30
**Spikes processed:** 3 (019a, 019b, 019c)
**Feature area:** two views, one stem (`references/two-view-stems.md`)

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 019a | height-matching | comparison | ✗ INVALIDATED | Two views, one stem |
| 019b | arc-length | comparison | ✗ INVALIDATED | Two views, one stem |
| 019c | monotone-alignment | comparison | ✓ WINNER of 019 | Two views, one stem |

## Key Findings

**Drawing order along a stem is the one thing both views agree on.**
- Monotone alignment on the shared axis fuses a front and a side stroke within 0.047 of the true curve on all five test curves.
- Height lookup collapses on hooks (0.53), and arc length on helices (0.11) and flat runs (0.15).
- The alignment's mismatch needs no ground truth and doubles as a pairing signal: pairing lowest mismatch first is right whenever the strokes can decide.
- Identical heights and profiles are ambiguous, so the interface must show pairs.

Next: any number of views as additional data (spike 020).

---

# Spike Wrap-Up Summary: generative-vectors, spike 020

**Date:** 2026-10-02
**Spikes processed:** 1 (020)
**Feature area:** two views, one stem (extended to any number of views)
**Skill output:** `./.claude/skills/spike-findings-tapestry/` (`references/two-view-stems.md` extended, `sources/020-multi-view/`)

## Key Findings

**A view is data.** Any number of views fuse in one least-squares solve per point along a parameter fixed by the best-conditioned pair, so a later view is one more commit that sharpens the stem. Mean error falls 0.060 → 0.042 → 0.037 → 0.035 from 2 to 5 views with hand drift. **Weights must be absolute** (`min(1, (0.1/residual)⁴)`): four relative rules failed, because with few views an outlier hides behind the median. Quantized Q16.16 frames silently re-seeded the stem until the normals were normalised and the seed pair made sticky.

---

# Spike Wrap-Up Summary: desktop-layer

**Date:** 2026-10-02
**Idea:** desktop-layer (`.planning/notes/desktop-layer-vision.md`)
**Spikes processed:** 4 (021–024)
**Feature areas:** desktop overlay and guide · screen capture · edge tab and desktop notes · window feed and document identity
**Skill output:** `./.claude/skills/spike-findings-tapestry/` (four new references, `sources/021…024`)

## Processed Spikes

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 021 | guide-circle-atspi | standard | ✓ VALIDATED | Desktop overlay and guide |
| 022 | region-capture-portal | comparison | ✓ VALIDATED | Screen capture |
| 023 | edge-tab-layershell | standard | ✓ VALIDATED | Edge tab and desktop notes |
| 024 | active-window-feed | standard | ⚠ PARTIAL | Window feed and document identity |

## Key Findings

**The desktop layer is feasible on KDE Plasma 6.6 Wayland, from a small Python/Qt helper with nothing compiled.** Every on-screen piece is a layer-shell surface (`org.kde.layershell` from PyQt6/QML). Electron can't make any of them on Wayland, so the build is Electron for the spatial app plus a native helper.

**The guide points at real controls.** AT-SPI exposes whole menu structures, closed menus included. On Wayland its positions are window-relative, and a KWin script supplies the window origin by pid. Kaelen saw the highlight land on Kate's File menu above every window, step to Save As…, follow drags and hide on other desktops. It doesn't follow KWin's desktop-swipe animation.

**Capture has two routes.** The Screenshot portal (no dialog, 1–1.4 s, leaves a file in `~/Pictures`) suits picture anchors. ScreenCast with a restore token (one consent, then silent 8 ms starts and 0.1 ms grabs from a cached frame) suits the guide. Logical-coordinate crops are accurate to ≤ 1 px at 1.7×.

**The edge tab feels right.** Kaelen: "it's fantastic … I LOVE how minimalist it is". Wayland's implicit grab drags a note out of a small surface, and `OnDemand` keyboard never steals typing. The trade-off: a bigger "near" zone blocks right-clicking the desktop, so it stays shy.

**Which file a window shows has no single source.** The focus feed is 0.8 ms median. Dolphin's exact folder comes from its AT-SPI location button (the activity database lags one step), images resolve through title + recent files, and Kate through its swap file. Browsers, Unity and Blender fall back to picture plus summary.

## What Is Still Open

- macOS (unspiked; research says easier).
- The vision fallback for apps without accessibility trees.
- The highlight during desktop-switch animations.
- Asking the user to turn on the session accessibility flag.
- The Electron ↔ helper protocol.
- Candidate designs from Kaelen's feedback: a wider, shorter hover strip, and the tab staying out after a drop as a notes-list button.
