/**
 * stage/colour.ts — the deterministic node colour (CANV-03).
 *
 * A node is coloured from FNV-1a 32 over the UTF-8 bytes of its brush
 * description — the same bytes the sim compares byte-wise when it defines a
 * brush, so 'ink' and 'ink ' (and NFC vs NFD) are different brushes AND
 * different colours. Math.imul keeps the 32-bit multiply exact and `>>> 0`
 * keeps the running hash unsigned, so the number is the same in every JS
 * engine and equals the C reference implementation over the same bytes.
 */
import { Color } from 'three'

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** FNV-1a 32-bit over the UTF-8 encoding of `s`; `fnv1a32('')` is 0x811c9dc5. */
export function fnv1a32(s: string): number {
  let h = FNV_OFFSET
  for (const b of new TextEncoder().encode(s)) {
    h ^= b
    h = Math.imul(h, FNV_PRIME) >>> 0
  }
  return h >>> 0
}

/** Hue = (hash mod 360) / 360, saturation 0.6, lightness 0.5. A fresh Color each call. */
export function colourFor(description: string): Color {
  return new Color().setHSL((fnv1a32(description) % 360) / 360, 0.6, 0.5)
}
