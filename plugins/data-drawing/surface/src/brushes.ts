/**
 * brushes.ts — the four shipped presets and the append-only brush table
 * (STRK-04, surface half).
 *
 * PRESETS mirror DD_PRESETS (sim/include/ddsim/presets.hpp) byte for byte:
 * mass, radius and spacing are the exact Q32.32 raw integers the C++ table
 * holds. They are NOT floats that "round back" — 1.1 * 2^32 rounds to
 * 4724464026 while the C++ raw is 4724464025 (truncated), and 0.35 gives
 * 1503238554 vs 1503238553 — so a float table would encode different bytes
 * and the `presets` golden would fail. encoder.test.ts proves equality.
 *
 * A version is never mutated: BrushTable.edit builds a NEW spec from the
 * base plus the patch and defines it as the next version id; earlier
 * versions stay in `versions` and old strokes keep theirs (the sim's
 * append-only table is the authority; this mirror only remembers what it
 * successfully defined).
 */
import { IDENTITY_CURVE, Q32_ONE, fromQ32, toQ32, type BrushVersionSpec } from './ddsim-abi'

export type { BrushVersionSpec }

/** A defined version: float readings for display and the node field, plus the exact raw values the sim holds. */
export interface BrushVersion {
  /** The id the sim assigned (1-based, sequential). */
  readonly id: number
  readonly description: string
  readonly mass: number
  readonly radius: number
  readonly spacing: number
  readonly curve: readonly number[]
  /** The Q32.32 raw integers that were encoded; an edit starts from these, not from the floats. */
  readonly raw: { readonly mass: bigint; readonly radius: bigint; readonly spacing: bigint }
}

/** Fields an edit may change; anything omitted is copied (raw) from the base version. */
export interface BrushPatch {
  description?: string
  mass?: number | bigint
  radius?: number | bigint
  spacing?: number | bigint
  curve?: readonly number[]
}

/**
 * ink 1 / rust 4 / clay 16 / lead 64 — the mass is the feel knob; radius
 * and spacing differ mildly so the four are visually distinguishable.
 * Raw Q32.32 from DD_PRESETS: radius 0.75 / 0.9 / 1.1 / 1.3, spacing
 * 0.5 / 0.45 / 0.4 / 0.35 (the comments are the float readings).
 */
export const PRESETS: readonly BrushVersionSpec[] = Object.freeze([
  Object.freeze({ description: 'ink', mass: 1n * Q32_ONE, radius: 3221225472n, spacing: 2147483648n, curve: IDENTITY_CURVE }), // mass 1, radius 0.75, spacing 0.5
  Object.freeze({ description: 'rust', mass: 4n * Q32_ONE, radius: 3865470566n, spacing: 1932735283n, curve: IDENTITY_CURVE }), // mass 4, radius 0.9, spacing 0.45
  Object.freeze({ description: 'clay', mass: 16n * Q32_ONE, radius: 4724464025n, spacing: 1717986918n, curve: IDENTITY_CURVE }), // mass 16, radius 1.1, spacing 0.4
  Object.freeze({ description: 'lead', mass: 64n * Q32_ONE, radius: 5583457485n, spacing: 1503238553n, curve: IDENTITY_CURVE }), // mass 64, radius 1.3, spacing 0.35
])

export interface BrushDefiner {
  defineBrush(spec: BrushVersionSpec): Promise<number>
}

export class BrushTable {
  /** Every version this table defined, in id order. Entries are frozen and never replaced. */
  readonly versions: BrushVersion[] = []
  /** The selected version id (0 until the first define). */
  current = 0

  private readonly byId = new Map<number, BrushVersion>()

  constructor(private readonly sim: BrushDefiner) {}

  /** Defines `spec` as the next version; resolves to its id. Rejects with the sim's DdError. */
  async define(spec: BrushVersionSpec): Promise<number> {
    const raw = { mass: toQ32(spec.mass), radius: toQ32(spec.radius), spacing: toQ32(spec.spacing) }
    const curve: readonly number[] = Object.freeze([...(spec.curve ?? IDENTITY_CURVE)])
    const id = await this.sim.defineBrush({ description: spec.description, ...raw, curve })
    const version: BrushVersion = Object.freeze({
      id,
      description: spec.description,
      mass: fromQ32(raw.mass),
      radius: fromQ32(raw.radius),
      spacing: fromQ32(raw.spacing),
      curve,
      raw: Object.freeze(raw),
    })
    this.versions.push(version)
    this.byId.set(id, version)
    if (this.current === 0) this.current = id
    return id
  }

  /**
   * Creates a NEW version from `baseId` plus `patch`, selects it and resolves
   * to the new id. The base version is untouched (append-only).
   */
  async edit(baseId: number, patch: BrushPatch): Promise<number> {
    const base = this.get(baseId)
    if (base === undefined) throw new RangeError(`unknown brush version ${baseId}`)
    const id = await this.define({
      description: patch.description ?? base.description,
      mass: patch.mass ?? base.raw.mass,
      radius: patch.radius ?? base.raw.radius,
      spacing: patch.spacing ?? base.raw.spacing,
      curve: patch.curve ?? base.curve,
    })
    this.current = id
    return id
  }

  /** The version with that id, or undefined. Satisfies the node field's BrushLookup. */
  get(id: number): BrushVersion | undefined {
    return this.byId.get(id)
  }

  select(id: number): void {
    if (this.get(id) === undefined) throw new RangeError(`unknown brush version ${id}`)
    this.current = id
  }

  /** A human-readable label: `v<id> <description> m=<mass>`. */
  label(v: BrushVersion): string {
    return `v${v.id} ${v.description} m=${v.mass}`
  }
}
