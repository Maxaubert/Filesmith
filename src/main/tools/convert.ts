// Engine-side convert helpers. The catalog + rules live in @shared/convert so the
// UI uses the exact same data; this module adds the argument builders and quality
// mapping the runner needs.
export {
  canCompress,
  categoryFormats,
  convertTargets,
  defaultTargetExt,
  isSameFormat,
  magickExtraFor,
  normalizeExt,
  toolForKind,
  type FormatOption
} from '@shared/convert'

/** ImageMagick args: `magick <input> [extra...] <output>`. */
export function buildMagickArgs(input: string, output: string, extra: string[] = []): string[] {
  return [input, ...extra, output]
}

/** ffmpeg args: `ffmpeg -y -i <input> [extra...] <output>`. */
export function buildFfmpegArgs(input: string, output: string, extra: string[] = []): string[] {
  return ['-y', '-i', input, ...extra, output]
}

/** Map a quality preset ('smaller'|'balanced'|'best') or number to a magick
 * -quality value (1..100), or null to leave the default. */
export function qualityNum(q: unknown): number | null {
  if (typeof q === 'number' && q > 0) return Math.max(1, Math.min(100, Math.round(q)))
  if (q === 'smaller') return 60
  if (q === 'balanced') return 82
  if (q === 'best') return 95
  return null
}
