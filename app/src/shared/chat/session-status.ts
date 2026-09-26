/**
 * A chat session's status: its state, status text and level (Phase 2.8,
 * D-10..D-14, SC4).
 *
 * One pure reducer turns what was observed into what the card and the panel
 * show. Its inputs are the session's chat events in order (the engine's, the
 * person's `user`, and the service-level `status` that `set_status` produces)
 * and the person's acknowledgement (`ack`: the pointer rests on the card,
 * focus, the enlarged view, a send). Nothing is ever guessed from reply text:
 * Needs you comes only from `set_status` with `needs: true` or level 3, and
 * Failed only from an `error` or a failed `done`, so it can never come out as
 * Done.
 *
 * Status is chrome, never history (D-10). No part of this module's output
 * enters a tree, a commit or a hash. The only thing that outlives the renderer
 * is the last status text, which main keeps per session in chats.json
 * (outside every `.tree`) so a relaunch shows Idle with it (D-12).
 *
 * Pure TypeScript: no Electron, Node or DOM import, so main (which stores the
 * last status text), the renderer (which draws the state) and vitest all load
 * the identical module.
 */

/** The highest level a status may ask for until rank exists (D-14). */
export const STATUS_LEVEL_CEILING = 3

/** A level as an integer from 0 to the ceiling; anything unreadable is 0. */
export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return level > 0 ? STATUS_LEVEL_CEILING : 0
  return Math.min(STATUS_LEVEL_CEILING, Math.max(0, Math.trunc(level)))
}
