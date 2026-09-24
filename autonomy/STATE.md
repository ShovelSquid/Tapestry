# STATE — the handoff between autonomous sessions

Read fully at the start of every session. Rewrite the "Next" section at
the end of every session so its first item can be started cold.

**2026-09-24 redirect.** `phase-2-implementation-v1` was merged into this
branch. It brings the deterministic kernel (`tapestry/kernel/`), the
Electron app (`app/`), the plugin SDK (`sdk/`), and plugins. Mathspace is
now the engine over the kernel, hosted as `plugins/mathspace/`, per the
rewritten `mathspace_plan.md`. The SDL Space page work (`tapestry/core`)
was reverted to v1's files; that path is abandoned. The store, hash,
actions, replay tool, and goldens built before the redirect are kept.

## Phases

| Phase | Status |
| --- | --- |
| 1 engine over the kernel | built and tested headlessly (`836a4da`); only the human GUI confirmation is open, see Blocked |
| 2 expressions | in progress: fxmath (`3ca1482`), ast+parser (`1725143`), bytecode (`30fc1a6`), vm (`3b25475`) done; action 37 + step eval + golden `plot`, plugin side, diff remain |
| 3 force rules | not started |
| 4 constraints | not started |
| 5 views | not started |
| 6 metrics | not started |
| 7 fold ddsim | not started |

## In progress

Nothing. Tree is clean. (`autonomy/watch.py` is the operator's log
viewer; it is theirs to edit.)

## Next

1. **GUI confirmation of phase 1 (human, or a session that can drive
   Electron).** `npm install` at the root (or symlink node_modules, see
   Learned), `npm run build:native` in `app/` if
   `app/native/build/Release/tapestry_addon.node` is missing, `npm run
   engine:wasm` in `plugins/mathspace`, then `npm run dev` in `app/`.
   Create a note, set `velocity.x real 1` in the inspector, run the
   command `mathspace.run`, watch it move, `mathspace.pause`, check the
   `.tree`. If a session cannot drive the GUI, skip this: the headless
   check in `plugins/mathspace/test/tree.test.js` already covers the
   file-level condition. Either way, do not block phase 2 on it.
2. **Phase 2, next slice: action 37 `BindField` + bound-field
   evaluation in `step()` + golden `plot`.** In `action.hpp`/`action.cpp`:
   kind 37 `BindField(note u64, name, bytecode bytes)`; `World::apply`
   decodes the bytecode with `expr::decode` (reject `BadAction` on any
   error), then sets `Field{name, dim = program.dim, bound = true,
   bytecode}` keeping existing lanes if the field exists at that dim
   (else zero), via `set_field` (so `pos` on a Space and dim rules still
   apply). Unbinding: bind with empty bytes clears `bound`/`bytecode`
   (or a `SetField` over it; pick one, record). `hash.cpp` already writes
   `bound` and `bytecode` bytes in the field record (`wire.hpp`), check
   nothing else changes; bump the walk's rule pin in `version.hpp` since
   `step()` gains behaviour. `step.cpp`: after the bootstrap rule, for
   every note in id order, every bound field in name order, `expr::eval`
   with `other = nullptr` against the pre-step snapshot? No: evaluate
   against the live world in order (simple, deterministic, record it);
   on a VM error leave the lanes as they were (phase 3 adds the error
   field on the node). Golden `tests/golden/ms/plot.actions`: a space,
   two notes, bind `y.expr` = `sin(self.x)`-like expressions plus a
   `norm`, a `curve` on `world.tick`, and an `if`; a few checkpoints;
   record with `ms_replay --write-golden` and confirm Release and UBSan.
   Fixture hex from Python per `action.hpp`'s grammar; the bytecode bytes
   come from a tiny doctest or `ms_replay` helper that prints
   `encode(compile(parse(text)))` (add `ms_replay --compile "<text>"` if
   there is no simpler way; dims for refs need a world, so compile inside
   the fixture generator against the same actions).
3. Then the plugin side: `ms_compile(handle, note_id, text, out, cap)`
   ABI call (one parser, one grammar, hashed bytecode; compile against
   the engine's world with `WorldDims`), `image.js` mapping `f.expr text`
   props to action 37, the snapshot/diff writing evaluated lanes back so
   the inspector shows the value after a step (phase 2 done condition),
   a vitest for it. `diff.hpp` (symbolic d/d(self.f.lane)) is needed by
   phase 4 and can be the last phase 2 slice or the first phase 4 slice.

## Done

- `3b25475` ms2 vm: `include/mathspace/expr/vm.hpp`, `src/mathspace/expr/vm.cpp`,
  `tests/mathspace/expr_vm_test.cpp` (every op and builtin, all five
  reference kinds, run-time NoOther/NoSuchNote/NoSuchField/DimChanged/
  NoSpace/UnknownRef, malformed programs, bytes round trip).
- `30fc1a6` ms2 bytecode: `include/mathspace/expr/bytecode.hpp`,
  `src/mathspace/expr/bytecode.cpp`, `tests/mathspace/expr_bytecode_test.cpp`
  (compile with shape check, verify, encode/decode round trips and
  truncation sweeps, jump layout, stack bound).
- `1725143` ms2 ast+parser: `include/mathspace/expr/{ast,parser}.hpp`,
  `src/mathspace/expr/{ast,parser}.cpp`, `tests/mathspace/expr_parser_test.cpp`
  (247 assertions: exact literals, precedence, if, vectors, components,
  refs, calls, every error code with offset, depth/node bounds,
  post-order layout). `to_decimal`/`to_sexpr` for tests and diagnostics.
- `3ca1482` ms2 fxmath: `include/ddsim/fxmath.hpp` (`sincos sin cos atan2
  exp log pow`, CORDIC Q3.60 x48, BKM Q5.58 x58, all constexpr, literal
  loop bounds), `tools/gen_fxmath/gen.py` (mpmath tables and oracle),
  `tests/mathspace/fxmath_oracle.inc` (~860 inputs), `fxmath_test.cpp`
  (tolerances, bit-exact digest `727731501767094518`, control-flow scan).
- Phase 1 (ms1), oldest last, one line each; git has the details:
  `836a4da` real-tree check + lane padding; `b223a54` README status;
  `a111181` run loop `runner.js`; `07f35f4` `image.js` + checkpoint
  fixture; `feab148` plugin skeleton + vitest goldens; `f7013b3` wasm
  target; `8587ec9` C ABI; `dc75224` lazy notes snapshot; `a247eab`
  bootstrap integrate rule + golden `velocity`; `0903619` kernel ids;
  `3cd79d9` build scaffolding; `1d6f2f1` driver bash 3.2 guard; note
  store/world/hash walk/actions 32..36/replay tool/goldens `empty` and
  `two-notes` up to `943b9bb`; SDL Space page `bdf03eb`..`8774401`
  reverted in the redirect; `215602c` merge of `phase-2-implementation-v1`.

## Decisions

- VM domain errors (2026-09-24, `3b25475`): `/ 0`, `sqrt(x<0)`,
  `log(x<=0)`, `pow(x<=0, y)` yield 0 in every build and are not
  evaluation errors, because `a / norm(a)` at `a = 0` is ordinary physics
  and an error would stop the whole field. The VM checks before calling
  fx64/fxmath so their Debug asserts never fire on user data. Reference
  failures (missing note/field, dim changed, no `other`) are errors.
  `world.tick` is pushed as an integer mod 2^31. `curve` knots sit at
  `i/(d-1)` with `t` clamped to [0, 1].
- Bytecode shapes (2026-09-24, `30fc1a6`): `+ -` need equal dims; `*`
  broadcasts a scalar over a vector (either side); `/` only by a scalar;
  scalar builtins (`min max abs clamp sqrt sin cos atan2 exp log pow`)
  take scalars only, not elementwise (extend later if a preset needs
  it); `[[1]]` is legal because a one-vector is a scalar. Ref dims come
  from a `DimResolver` at compile time and are baked into `LoadRef`, so
  `other.f` needs a resolver that knows the pair (phase 3); the VM
  errors if a field's dim has changed since binding. `if` is two forward
  jumps, not a select, so untaken branches never run. `MakeVec` exists
  only so the verifier sees d scalars become one value; the VM does no
  lane moves for it. Bytecode header is version 1, `MAX_OPS` 8192,
  `MAX_STACK_LANES` 1024.
- Expression grammar choices the plan left open (2026-09-24, `1725143`):
  `if c then a else b` with keywords, lowest precedence, else-branch runs
  to the end (parenthesise to embed). Comparison is non-associative
  (`a < b < c` is a parse error). Components are `.x .y .z .w` or `.0`
  to `.7`; a component or ref name after `space.`/`world.` is any
  identifier, the VM restricts to `dim`/`tick`. Number literals: integer
  part below 2^31, at most 32 fraction digits, must be exactly k/2^32
  (`0.1` is `InexactNumber`, matching image.js for `real` props).
  No `^` operator and no `len` (the design doc's example uses them; the
  plan's list is `pow`/`norm`, so the plan wins). Node ids in text are
  `node(n12)`, the kernel's spelling. Bounds: `MAX_DEPTH` 64 nesting
  levels (parens and unary minus count), `MAX_NODES` 4096.
- fxmath rounding: CORDIC results (`sin cos atan2`) round to nearest at
  the final Q3.60 to Q32.32 shift (`to_grid`), because the working value
  errs both ways and a floor would give `sin(0) = -2^-32`. `exp` and `log`
  keep the floor since their shift-and-add never over-approximates.
  `sin`/`cos`/`atan2` are within 1 ulp of the true floor, `log` within 2,
  `exp` within 2^-50 relative, `pow` within 2^-48 relative (its exponent
  product is formed in Q5.58, not on the Q32.32 grid). Contract results:
  `log(x<=0)` and `pow(x<=0, y)` return 0 and assert in Debug; `exp`
  saturates at `INT64_MAX` above 31 ln2 and returns 0 below -33 ln2;
  `atan2(0, 0) = 0`. The mpmath script is the only place a floating value
  is computed, and it lives under `tools/`, outside the gate. (2026-09-24,
  `3ca1482`.)
- A lane-addressed field (`f.x`, `f.2`) is a vector in the note's space
  and is zero-padded to the space's dim; a bare name is a scalar of dim
  1. Needed because the plan's done condition sets only `velocity.x` and
  `step.cpp` skips a velocity whose dim differs from `pos`. More lanes
  than the space has is still a reported problem. (2026-09-24, `836a4da`.)
- Run loop: a foreign commit found at flush time drops the engine's
  pending ticks and rebuilds; a refused submit forces a rebuild before
  the next commit; snapshot and diff are taken before any await so ticks
  during an in-flight commit go to the next one; `mathspace.step` is a
  no-op while running. Engine seed is 1. (2026-09-24, `a111181`.)
- The implicit space (notes with `position.*` and no `space` ref) is one
  per image under id `2^63`, a value no kernel `n<k>` reaches, dim 2.
  `diff` ignores snapshot notes absent from the before-image, so the
  implicit space never becomes a kernel op. (2026-09-24, `07f35f4`.)
- An inexact real (not `k/2^32`) drops the whole field it belongs to from
  the image and is reported in `buildImage(...).problems`; the note is
  still created. Rejecting per the plan rather than rounding; see
  Blocked. (2026-09-24, `07f35f4`.)
- Mathspace is a plugin over the kernel, not a second store. Durable
  state is the `.tree`; the engine image is derived. (2026-09-24, from
  the merge review.)
- real↔fx64 conversion is exact and lives in JS at the plugin boundary,
  so no double enters the gated C++ tree.
- Note ids are kernel ids. The structured id layout is dropped.
- The engine never allocates ids: `CreateSpace`/`CreateNote` carry the
  kernel's id; the store rejects zero and duplicates and does not
  track deleted ids (`0903619`). `ms_serialize` uses ddsim's cap
  protocol; `ms_error` values equal `mathspace::Error`; `ms_version()`
  is `MS_ABI_VERSION` 1, separate from the walk's `FORMAT_VERSION`
  (`8587ec9`).
- Phase 1 ships one hardcoded bootstrap rule (`position += velocity`) so
  something moves; phase 3 deletes it.

## Learned

- The `Ast` is post-order with children as contiguous runs in `Ast::args`,
  so `to_sexpr` is one index loop over a `vector<string>`; the bytecode
  compiler can be the same loop. Variadic children must be collected in
  a local vector and appended in one go, or runs interleave.
- `(UINT64_MAX - 9) / 10` as a decimal overflow guard rejects
  `18446744073709551615`; compare against `UINT64_MAX / 10` and the
  last digit against `UINT64_MAX % 10`.
- doctest: `MESSAGE` ignores `std::hex` (print decimal); a `const char*`
  first token in `CHECK_MESSAGE` prints as `1` (wrap in `std::string`);
  a helper named `apply` collides with `std::apply` via ADL. `INT64_MIN`
  in a generated `.inc` must be `(-9223372036854775807 - 1)`.
- The 2 pi reduction must not use the Q32.32 constant alone: floor(x /
  TWO_PI_32) times the truncated constant loses half an ulp per period,
  which showed as 3-7 ulps at |x| ~ 1000 and millions at 2^31. Three
  28-bit-aligned parts (`TWO_PI_32`, `TWO_PI_MID`, `TWO_PI_LO`) fix it
  and cost two extra multiplies.
- `app/native/build/Release/tapestry_addon.node` was copied from the
  primary checkout (`/Users/kaelencook/Tapestry/app/native/build/Release/`)
  because `tapestry/kernel` and `app/native` are identical to
  `phase-2-implementation-v1` here (`git diff --stat` is empty) and
  `npm run build:native` needs Electron headers. It is gitignored. The
  plugin's vitest imports `app/test/helpers/temp-tree.ts` and
  `app/src/main/plugin-host.ts` by relative path; both are free of
  runtime Electron imports, so they load in plain Node.
- Kernel `real` values print as shortest round-trip decimals
  (`set n1 position.x real 60`), so the `.tree` assertions can match
  whole lines.
- This worktree has no `node_modules`; the pattern is a symlink to the
  primary checkout's: `ln -s /Users/kaelencook/Tapestry/node_modules
  node_modules` (gitignored). vitest 2.1.9 lives there. Plugin tests:
  `npm test` in `plugins/mathspace` after `npm run engine:wasm`.
- Plugin files are CommonJS (`require`d by the host), so the vitest config
  is `vitest.config.mjs` and tests reach `engine.js` through
  `createRequire` (`test/engine-cjs.js`); `"type": "module"` in
  package.json would break the host's require.
- Wasm build: `source ~/emsdk/emsdk_env.sh` (prints 6.0.10), then
  `cmake --preset wasm-release && cmake --build build/wasm-release`.
  Configure+build is ~15 s. `node tools/wasm-hash-check.mjs
  build/wasm-release/mathspace.mjs tests/golden/ms/<f>.actions
  tests/golden/ms/<f>.sha256` printed `OK` for empty, two-notes and
  velocity on the first try; the Wasm hashes equal the native goldens.
  `mathspace.wasm` is 36 KB. `_ms_create` takes a BigInt seed and
  `_ms_tick` returns one (WASM_BIGINT is on by default).
- `tests/golden/ms/*.actions` are globbed by `CMakeLists.txt`, so a new
  fixture gets its two-process test at configure time with no edit.
  Write fixture hex with a few lines of Python from the grammar in
  `action.hpp` rather than by hand (a by-hand attempt was off by a byte).
- Re-recording goldens: `build/native-debug/ms_replay <f>.actions
  --write-golden <f>.sha256`, then Release and UBSan must agree.
- Debug/Release/UBSan configure+build+ctest are each ~10-20 s; run all
  three every slice. `mathspace_tests` gets `MATHSPACE_GOLDEN_DIR`.
- The tapestry kernel builds alone with
  `cmake -S tapestry -B build/tapestry-kernel -DTAPESTRY_BUILD_RENDER=OFF
  -DTAPESTRY_BUILD_APP=OFF` and its 59 tests pass in ~2 s. Render ON
  needs network for glad on first configure.
- The app stores positions as `position.x`/`position.y` reals measured
  from the note's tree frame origin, plus `pinned bool`
  (`app/src/renderer/layout/placement.ts`). Match these keys exactly.
- The SDK (`sdk/src/index.ts`) gives plugins `kernel.getNodes/getNode/
  getEdges/status/submit`; commits are stamped `plugin <dir-name>`.
  Surfaces get no kernel access in API 1.
- `.claude/CLAUDE.md` (merged from v1, GSD-generated) says work happens
  in `/Users/kaelencook/Tapestry` on branch `phase-2-implementation-v1`.
  That is the primary checkout's instruction, not this worktree's; the
  root `CLAUDE.md` overrides it here.

## Blocked

(questions a human would have been asked; answered by the session's best
judgement, recorded here so a human can revisit)

- **Phase 1 GUI confirmation.** The plan's done condition says "in the
  app". Every file-level and determinism clause is covered by tests; an
  unattended session cannot click Run in Electron. A human should do
  Next item 1 once and tick this off. (2026-09-24)

- Dragged notes may hold positions that are not `k/2^32` (a drag at a
  fractional zoom divides by the zoom). The plan says such reals are
  rejected, so `buildImage` drops that note's `pos` and it does not move.
  If the phase 1 app check shows this bites, the run loop could round
  and commit the rounded position first; that is a plan change, so it is
  left for a human. (2026-09-24)
