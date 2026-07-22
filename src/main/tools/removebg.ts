import type { JobOptions } from '@shared/types'
import {
  BG_DEFAULTS,
  BG_MODEL_VALUES,
  fillRgba,
  normalizeAlpha,
  type BgFill,
  type BgModel
} from '@shared/removebg'

// rembg argument building. Pure, no Electron.
//
// Verified against rembg 2.0.75/2.0.77: the `i` subcommand takes
//   -m MODEL  -a  -af INT  -ab INT  -ae INT  -om  -ppm  -bgc R G B A
// with -bgc taking four BARE space-separated ints (not a comma list, not hex).

/** Only emit models from the licence-vetted allowlist, whatever the UI sends. */
export function bgModelOf(options: JobOptions): BgModel {
  const m = String(options.bgModel ?? BG_DEFAULTS.bgModel) as BgModel
  return BG_MODEL_VALUES.includes(m) ? m : BG_DEFAULTS.bgModel
}

export function buildRembgArgs(input: string, output: string, options: JobOptions): string[] {
  const args = ['i', '-m', bgModelOf(options)]

  // Default to ON when unspecified: the quality options aren't user-facing, so
  // an omitted flag means "the good default", not "off".
  if (options.bgAlpha ?? BG_DEFAULTS.bgAlpha) {
    // The four alpha-matting flags only do anything together, and the thresholds
    // have to be a valid pair or the trimap degenerates.
    const { fg, bg, erode } = normalizeAlpha(
      Number(options.bgAlphaFg ?? BG_DEFAULTS.bgAlphaFg),
      Number(options.bgAlphaBg ?? BG_DEFAULTS.bgAlphaBg),
      Number(options.bgErode ?? BG_DEFAULTS.bgErode)
    )
    args.push('-a', '-af', String(fg), '-ab', String(bg), '-ae', String(erode))
  }

  if (options.bgPostProcess ?? BG_DEFAULTS.bgPostProcess) args.push('-ppm')

  if (options.bgOnlyMask) {
    // A mask is a greyscale matte; compositing it onto a colour is meaningless,
    // so -om wins and -bgc is dropped rather than sent as a contradiction.
    args.push('-om')
  } else {
    const rgba = fillRgba(
      String(options.bgFill ?? BG_DEFAULTS.bgFill) as BgFill,
      String(options.bgCustomColor ?? BG_DEFAULTS.bgCustomColor)
    )
    // Omit the flag entirely for transparent: rembg's default is already
    // (0,0,0,0), and passing it explicitly buys nothing.
    if (rgba) args.push('-bgc', ...rgba.map(String))
  }

  args.push(input, output)
  return args
}

/**
 * Composite the transparent cutout over a chosen backdrop image.
 *
 * The backdrop is cover-fitted, not stretched: `WxH^` scales it to the smallest
 * size that covers the subject's frame, then `-extent` with centre gravity crops
 * the overflow. Plain `-resize WxH` would letterbox and `WxH!` would distort a
 * backdrop whose aspect ratio differs from the photo's, which is the normal case
 * when someone picks an arbitrary wallpaper.
 */
export function buildCompositeArgs(
  background: string,
  cutout: string,
  output: string,
  width: number,
  height: number
): string[] {
  const size = `${width}x${height}`
  return [
    `${background}[0]`,
    '-resize',
    `${size}^`,
    '-gravity',
    'center',
    '-extent',
    size,
    cutout,
    '-composite',
    output
  ]
}

/**
 * rembg writes a progress bar to stderr for folder mode but nothing useful for a
 * single file, so a per-image job reports the phase instead of a percentage.
 * Model load dominates: measured on an RTX 5090, birefnet-general takes ~10s to
 * load and ~5s to infer, so telling the user which phase it's in is the honest
 * signal (a fake percentage would sit still through the load).
 */
export function rembgPhase(onPhase: (message: string) => void): (chunk: string) => void {
  let loaded = false
  return (chunk: string) => {
    if (loaded) return
    // Any inference progress output means the session finished loading.
    if (/\d+%|it\/s|\d+\/\d+/.test(chunk)) {
      loaded = true
      onPhase('Removing background…')
    }
  }
}
