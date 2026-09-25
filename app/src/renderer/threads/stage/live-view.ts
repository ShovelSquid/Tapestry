/**
 * The live-view perspective camera (D-09, D-27; spike 001 thread.js:632-641
 * "live" branch), rebuilt so its basis is derived from the thread's own
 * stored frame rather than hardcoded.
 *
 * thread.js hardcoded the live camera's eye and look-at target as two
 * literal world-space triples, against an implicit fixed thread axis of
 * world `(0, 0, -1)`. D-27 makes that axis an explicit per-thread property
 * (`origin`, `direction`, `roll`), read through `parseThreadFrame`, so this
 * module rebuilds the *same* camera as an offset expressed in the thread's
 * own (right, up, forward) basis instead of world X/Y/Z: `forward` is the
 * thread's `direction`, `right`/`up` are derived from it (and rotated by
 * `roll` around that axis), and the offset numbers below are chosen so
 * that at the D-27 default (`origin 0 0 0`, `direction 0 0 -1`, `roll 0`)
 * the resulting eye and look-at target come out bit-for-bit identical to
 * the spike's own validated numbers (thread.js:636). Every thread in this
 * phase renders on that default, so this generalization carries no visual
 * risk (CONTEXT.md D-27), while a later anchor-cursor phase that sets a
 * non-default frame needs no renderer change at all — only a cursor.
 *
 * `ribbon.ts`'s `threadPoint`/`threadAxis` GLSL functions are the other
 * half of this: they read the *same* `uThreadOrigin`/`uThreadDirection`
 * uniforms this module's `setThreadFrame` populates, so the ribbon and the
 * glyphs draw along the identical axis the camera looks down.
 */

import * as THREE from 'three'
import type { ThreadFrame } from '../../../shared/threads/settings'
import { setOrigin, setThreadFrame, type StageUniforms } from './ribbon'

// The default frame's camera offset, expressed in the thread's own local
// (right, up, forward) basis rather than raw world coordinates — see this
// file's header for the derivation and the verified match against
// thread.js:636's literal numbers.
const EYE_RIGHT_OFFSET = 0.35
const EYE_UP_OFFSET = 0.28
const EYE_FORWARD_OFFSET = 1.2
const LOOK_FORWARD_OFFSET = -6

/** A reference "world up" used to build an orthonormal basis from
 * `direction` alone: `(0, 1, 0)` unless `direction` is nearly vertical, in
 * which case `(0, 0, 1)` avoids a degenerate cross product. */
function referenceUp(forward: THREE.Vector3): THREE.Vector3 {
  return Math.abs(forward.y) > 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
}

interface ThreadBasis {
  origin: THREE.Vector3
  forward: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
}

/** Builds the orthonormal (right, up, forward) basis a `ThreadFrame`
 * describes: `forward` is the stored `direction` (normalized), `right` and
 * `up` are derived from it and then rotated by `roll` degrees around
 * `forward` — the D-27 frame in full, never a hardcoded axis. */
function threadBasis(frame: ThreadFrame): ThreadBasis {
  const origin = new THREE.Vector3(frame.origin.x, frame.origin.y, frame.origin.z)
  const forward = new THREE.Vector3(frame.direction.x, frame.direction.y, frame.direction.z).normalize()
  const worldUp = referenceUp(forward)
  const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize()
  const up = new THREE.Vector3().crossVectors(right, forward).normalize()

  if (frame.roll !== 0) {
    const rollQuat = new THREE.Quaternion().setFromAxisAngle(forward, THREE.MathUtils.degToRad(frame.roll))
    right.applyQuaternion(rollQuat)
    up.applyQuaternion(rollQuat)
  }

  return { origin, forward, right, up }
}

export interface LiveViewHandle {
  readonly camera: THREE.PerspectiveCamera
  /** Repositions the camera from the thread's frame and rewrites
   * `uThreadOrigin`/`uThreadDirection` on the shared stage uniforms — call
   * once when the overlay mounts, and again only if the thread's stored
   * frame itself changes (a later anchor-cursor phase's concern; every
   * thread in this plan keeps the D-27 default for its whole life). */
  applyFrame(frame: ThreadFrame): void
  /** Updates the camera's aspect ratio and the uniforms' pixel-scale for a
   * resized stage area. */
  resize(width: number, height: number): void
  /** Per-frame: recenters the floating origin on `nowSeconds` (thread time)
   * and updates `uNowRel` — the live view always keeps "now" within the
   * ±half-hour a float32 world position can place precisely. */
  tick(nowSeconds: number): void
}

/**
 * Creates the D-09 live-view perspective camera and its per-frame update
 * function, sharing `uniforms` with the `Ribbon` and `GlyphLayer` this
 * overlay also owns.
 */
export function createLiveView(uniforms: StageUniforms): LiveViewHandle {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 20000)
  uniforms.uOrtho.value = 0
  // D-14: "the live view fades by distance only... nothing is hidden on
  // purpose; older writing gets smaller and dimmer with depth" and "there
  // is no age-based fading anywhere, and live text is never drawn below
  // full strength". thread.js's own live branch sets uFadeOn=1, which
  // ports to an explicit per-fragment `age = now - typedAt` alpha fade
  // (FADE=20 seconds) -- that is the spike's exploratory age-based fade,
  // which D-14 explicitly supersedes for this phase. Distance-only means
  // relying solely on ordinary perspective projection (size shrinks, and
  // coverage-based antialiasing dims a sub-pixel-sized dot/glyph, exactly
  // the "smaller and dimmer with depth" D-14 asks for) with uFadeOn off, so
  // `fadeFor` always returns 1.0 and nothing is hidden by age.
  uniforms.uFadeOn.value = 0
  uniforms.uSideGlyphPx.value = 0 // 0 selects the live view's own legibility gate

  function applyFrame(frame: ThreadFrame): void {
    setThreadFrame(uniforms, frame)
    const basis = threadBasis(frame)

    const eye = basis.origin
      .clone()
      .addScaledVector(basis.right, EYE_RIGHT_OFFSET)
      .addScaledVector(basis.up, EYE_UP_OFFSET)
      .addScaledVector(basis.forward, EYE_FORWARD_OFFSET)
    const target = basis.origin.clone().addScaledVector(basis.forward, LOOK_FORWARD_OFFSET)

    camera.position.copy(eye)
    camera.up.copy(basis.up)
    camera.lookAt(target)
  }

  function resize(width: number, height: number): void {
    camera.aspect = width / Math.max(1, height)
    camera.updateProjectionMatrix()
    uniforms.uPixelScale.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / Math.max(1, height)
  }

  function tick(nowSeconds: number): void {
    // The live view recenters the floating origin on "now" every frame
    // (thread.js's `updateCamera`), so `uNowRel` is always exactly 0 here —
    // only the side view (a later plan) centers on a fixed point in the
    // past, where `uNowRel` becomes meaningfully nonzero.
    const origin = setOrigin(uniforms, nowSeconds)
    uniforms.uNowRel.value = nowSeconds - origin
  }

  return { camera, applyFrame, resize, tick }
}
