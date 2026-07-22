import { normalizeExt } from '@shared/convert'
import type { UpscaleModel } from '@shared/compress'

// Real-ESRGAN (ncnn/Vulkan) argument building. No Electron.
//
// This is AI upscaling: the network invents plausible detail instead of
// interpolating, so it looks dramatically sharper than Lanczos on photos even
// though it scores WORSE on pixel-fidelity metrics like SSIM (it doesn't
// reproduce the original pixels, it produces convincing new ones). Verified
// visually against a 4x reference before choosing it.

/** Model file names shipped in resources/realesrgan/models. */
const MODEL_NAME: Record<'photo' | 'anime', string> = {
  photo: 'realesrgan-x4plus',
  anime: 'realesrgan-x4plus-anime'
}

/**
 * Formats the bundled binary reads reliably. Anything else (heic, jxl, svg,
 * exotic tiff…) is converted to PNG by the caller first, so the tool can accept
 * "any image format" without depending on what ncnn's loader happens to support.
 */
export const REALESRGAN_INPUT_EXTS = ['.png', '.jpg', '.webp']

/** True when the source must be converted to PNG before upscaling. */
export function needsPreConvert(ext: string): boolean {
  return !REALESRGAN_INPUT_EXTS.includes(normalizeExt(ext))
}

export interface UpscaleOpts {
  model: UpscaleModel
  /** 2, 3 or 4. All three are supported natively by the binary. */
  factor: number
  /** Per-tile size passed to `-t`. 0 = the binary's auto (largest that fits).
   * A small value (e.g. 128) bounds VRAM for the "Background" GPU mode. */
  tile?: number
}

/**
 * `realesrgan-ncnn-vulkan -i in -o out -n <model> -s <factor> -f png`.
 * Output is always PNG: the result is a large, detail-rich image and re-encoding
 * it to a lossy format would throw away the detail we just paid seconds of GPU
 * time to generate.
 */
export function buildUpscaleArgs(input: string, output: string, o: UpscaleOpts): string[] {
  const factor = [2, 3, 4].includes(o.factor) ? o.factor : 4
  const args = [
    '-i',
    input,
    '-o',
    output,
    '-n',
    // 'pid'/'comfy' never reach here (routed to a sidecar); default to photo.
    o.model === 'anime' ? MODEL_NAME.anime : MODEL_NAME.photo,
    '-s',
    String(factor),
    '-f',
    'png'
  ]
  if (o.tile && o.tile > 0) args.push('-t', String(o.tile))
  return args
}

/**
 * Real-ESRGAN reports progress as bare percentages on stderr ("12.50%"). Turn
 * those into 0-99 for the UI; a 4x upscale of a big photo takes seconds to
 * minutes, so a moving bar matters.
 */
export function upscaleProgress(
  onPercent: (pct: number) => void
): (chunk: string) => void {
  return (chunk: string) => {
    let m: RegExpExecArray | null = null
    const re = /(\d+(?:\.\d+)?)%/g
    for (let hit = re.exec(chunk); hit; hit = re.exec(chunk)) m = hit
    if (!m) return
    onPercent(Math.max(0, Math.min(99, Number(m[1]))))
  }
}
