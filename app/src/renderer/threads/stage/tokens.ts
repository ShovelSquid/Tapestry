/**
 * Stage colour tokens (UI-SPEC "Theming"): the WebGL stage never writes a
 * hex literal at a use site. Every colour a shader draws comes from a
 * `--tap-*` custom property, read from `:root` with `getComputedStyle` at
 * stage start-up and converted to a linear-light RGB triple for a shader
 * uniform. A theme change is therefore a values change (re-read the tokens,
 * re-upload the uniforms) and never a rewrite of ribbon.ts or glyphs.ts.
 *
 * "Convert to linear floats": custom properties carry sRGB text (a
 * six-digit hex triple, or `rgb(142, 138, 128)`), and a shader that blends
 * or multiplies colour
 * values should do so in linear light, not in sRGB — otherwise a 50% blend
 * of two tokens reads darker than either. `srgbToLinear` is the standard
 * sRGB electro-optical transfer function.
 */

/** The `--tap-*` custom properties this phase's stage reads. */
export const STAGE_TOKEN_NAMES = [
  '--tap-paper',
  '--tap-ink',
  '--tap-muted',
  '--tap-thread-line',
  '--tap-accent',
] as const

export type StageTokenName = (typeof STAGE_TOKEN_NAMES)[number]

/** A colour as linear-light [0,1] components, ready for a shader uniform. */
export interface LinearColor {
  r: number
  g: number
  b: number
}

export type StageTokens = Record<StageTokenName, LinearColor>

// ---------------------------------------------------------------------------
// Colour text parsing
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function srgbToLinear(c: number): number {
  const x = clamp01(c)
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

/**
 * Parses a CSS colour string as it comes back from `getPropertyValue` on a
 * custom property (the raw source text, e.g. six-digit hex, three-digit
 * hex, or `rgb()`/`rgba()`) into 0-255 sRGB byte components. Returns black
 * for anything unparseable, so a missing or malformed token degrades to a
 * silent, safe default rather than throwing during a render loop.
 */
function parseSrgbBytes(raw: string): { r: number; g: number; b: number } {
  const value = raw.trim()

  const shortHex = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(value)
  if (shortHex) {
    return {
      r: parseInt(shortHex[1] + shortHex[1], 16),
      g: parseInt(shortHex[2] + shortHex[2], 16),
      b: parseInt(shortHex[3] + shortHex[3], 16),
    }
  }

  const longHex = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(value)
  if (longHex) {
    return {
      r: parseInt(longHex[1], 16),
      g: parseInt(longHex[2], 16),
      b: parseInt(longHex[3], 16),
    }
  }

  const rgbFn = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value)
  if (rgbFn) {
    return { r: Number(rgbFn[1]), g: Number(rgbFn[2]), b: Number(rgbFn[3]) }
  }

  return { r: 0, g: 0, b: 0 }
}

/** Parses one CSS colour string into a linear-light [0,1] triple. */
export function parseLinearColor(raw: string): LinearColor {
  const { r, g, b } = parseSrgbBytes(raw)
  return { r: srgbToLinear(r / 255), g: srgbToLinear(g / 255), b: srgbToLinear(b / 255) }
}

// ---------------------------------------------------------------------------
// Reading the whole token set
// ---------------------------------------------------------------------------

/**
 * Reads every stage token from `root`'s computed style (default:
 * `document.documentElement`, i.e. `:root`) and converts each to linear
 * light. Called once at stage start-up and again whenever the caller wants
 * to react to a theme change — never on a per-frame basis, since geometry,
 * history and the glyph atlas must never rebuild from a token read
 * (UI-SPEC "Theming": "Theme change is a uniform re-upload").
 */
export function readStageTokens(root: Element = document.documentElement): StageTokens {
  const style = getComputedStyle(root)
  const tokens = {} as StageTokens
  for (const name of STAGE_TOKEN_NAMES) {
    tokens[name] = parseLinearColor(style.getPropertyValue(name))
  }
  return tokens
}

// ---------------------------------------------------------------------------
// Author palette (D-21, UI-SPEC "Author identity"): the 7-slot colour array
// stage/strands.ts and stage/glyphs.ts index by the `aActor`/author palette
// index (author-palette.ts's authorPaletteIndex: 0 self, 1-5 agents, 6
// unknown). Read alongside the rest of the stage's tokens, once at stage
// start-up (and again on a theme change) -- never per frame.
// ---------------------------------------------------------------------------

/** `--tap-author-*`, in `authorPaletteIndex`'s own 0-6 slot order. */
export const AUTHOR_TOKEN_NAMES = [
  '--tap-author-self',
  '--tap-author-1',
  '--tap-author-2',
  '--tap-author-3',
  '--tap-author-4',
  '--tap-author-5',
  '--tap-author-unknown',
] as const

/** Reads the 7-slot author palette as linear-light colours, in
 * `authorPaletteIndex` order (index 0 = self, 6 = unknown). */
export function readAuthorPalette(root: Element = document.documentElement): LinearColor[] {
  const style = getComputedStyle(root)
  return AUTHOR_TOKEN_NAMES.map((name) => parseLinearColor(style.getPropertyValue(name)))
}
