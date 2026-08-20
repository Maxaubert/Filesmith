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

/**
 * A source path with a scene spec (`[0]` = first frame) appended, safe for
 * paths containing `%`. Appending a scene spec switches ImageMagick to
 * InterpretImageFilename on READ, where `%d`/`%x`/… in the path (or its folder)
 * are consumed as format codes: `magick "100%off.png[0]" out.jpg` fails with
 * "unable to open image '1000ff.png'". `%%` round-trips to a literal `%`
 * (measured against the bundled binary), so escape before appending.
 */
export function magickFrame(path: string, frame = 0): string {
  return `${path.replace(/%/g, '%%')}[${frame}]`
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
