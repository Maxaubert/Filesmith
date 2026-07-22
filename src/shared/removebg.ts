// Background-removal options, shared by the UI and the engine.
//
// The model list is an ALLOWLIST, not rembg's full catalogue, and the reason is
// licensing rather than taste. rembg exposes 19 sessions and gives no per-model
// licence warning, so shipping its list wholesale would quietly redistribute
// non-commercial weights. Verified against primary sources:
//   bria-rmbg        -> resolves to RMBG-2.0, CC BY-NC 4.0. Hard exclusion.
//   u2net_human_seg  -> trained on the Supervisely Person dataset (non-commercial).
//   isnet-anime      -> scraped fandom provenance.
//   sam              -> prompt-driven binary masks; wrong tool for a cutout.
// Anything not in MODELS below must stay unreachable from the UI and from any
// argv we build.

export type BgModel = 'birefnet-general' | 'birefnet-general-lite' | 'u2net' | 'isnet-general-use'

/**
 * The models the engine will accept. The UI exposes no model picker and always
 * uses the default (birefnet-general, the best of them), so this is not a menu:
 * it's the boundary that keeps a non-vetted rembg session name from ever
 * reaching argv, whatever the caller passes.
 */
export const BG_MODEL_VALUES: BgModel[] = [
  'birefnet-general',
  'birefnet-general-lite',
  'u2net',
  'isnet-general-use'
]

/**
 * Output background: transparent, a solid colour, or another image composited
 * behind the subject. The image case is not a rembg feature — rembg only knows
 * `-bgc` (a solid RGBA) — so it's done as a second ImageMagick pass.
 */
export type BgFill = 'transparent' | 'white' | 'black' | 'green' | 'custom' | 'image'

export const BG_FILLS: { value: BgFill; label: string }[] = [
  { value: 'transparent', label: 'Transparent' },
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'green', label: 'Green screen' },
  { value: 'custom', label: 'Custom Color' },
  { value: 'image', label: 'Custom Image' }
]

const FILL_RGB: Record<
  Exclude<BgFill, 'transparent' | 'custom' | 'image'>,
  [number, number, number]
> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  green: [0, 177, 64]
}

/**
 * `-bgc R G B A` components, or null when rembg should leave the background
 * transparent. 'image' returns null too: the cutout has to stay transparent for
 * the compositing pass to have something to show through.
 */
export function fillRgba(fill: BgFill, customHex: string): [number, number, number, number] | null {
  if (fill === 'transparent' || fill === 'image') return null
  if (fill === 'custom') {
    const rgb = hexToRgb(customHex)
    return rgb ? [rgb[0], rgb[1], rgb[2], 255] : null
  }
  const [r, g, b] = FILL_RGB[fill]
  return [r, g, b, 255]
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Alpha-matting bounds. rembg's Click options declare no min/max, so an invalid
// pair is accepted and silently produces a degenerate trimap: the caller has to
// enforce these.
export const ALPHA_MIN = 0
export const ALPHA_MAX = 255
export const ERODE_MIN = 0
export const ERODE_MAX = 40

/**
 * The tool has exactly one user-facing choice: the background. Everything that
 * makes the cutout better is simply always on, rather than being a toggle the
 * user has to know to find — there is no reason someone would want worse edges.
 * The only cost is time (alpha matting is CPU-bound closed-form matting), which
 * is a fair trade for a tool whose whole job is the quality of the cutout.
 *
 * `bgOnlyMask` stays in the engine (a mask is a legitimate output) but has no
 * UI: it produces a greyscale matte, not a cutout, so it isn't a quality knob.
 */
export const BG_DEFAULTS = {
  bgModel: 'birefnet-general' as BgModel,
  /** Alpha matting: recovers hair and fur that a hard mask clips. */
  bgAlpha: true,
  /** rembg's tuned trimap thresholds: fg 240 / bg 10 / erode 10. */
  bgAlphaFg: 240,
  bgAlphaBg: 10,
  bgErode: 10,
  bgOnlyMask: false,
  /** Morphological clean-up of the mask; cheap and visibly better edges. */
  bgPostProcess: true,
  bgFill: 'transparent' as BgFill,
  bgCustomColor: '#ff0000',
  /** Absolute path of the backdrop for the 'image' fill; empty until picked. */
  bgImagePath: ''
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : 0)))

/**
 * Coerce the alpha-matting trio into a usable state. The foreground threshold
 * must stay strictly ABOVE the background one: the region between them is the
 * "unknown" band the matting solver works on, so an inverted or equal pair
 * leaves nothing to solve and the result collapses to a hard-edged cutout.
 */
export function normalizeAlpha(
  fg: number,
  bg: number,
  erode: number
): { fg: number; bg: number; erode: number } {
  const f = clamp(fg, ALPHA_MIN, ALPHA_MAX)
  const b = clamp(bg, ALPHA_MIN, ALPHA_MAX)
  return {
    fg: Math.max(f, b + 1) > ALPHA_MAX ? ALPHA_MAX : Math.max(f, b + 1),
    bg: Math.min(b, f - 1) < ALPHA_MIN ? ALPHA_MIN : Math.min(b, f - 1),
    erode: clamp(erode, ERODE_MIN, ERODE_MAX)
  }
}
