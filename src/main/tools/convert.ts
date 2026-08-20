// Engine-side convert helpers. The catalog + rules live in @shared/convert so the
// UI uses the exact same data; this module adds the argument builders and quality
// mapping the runner needs.
import type { FileKind } from '@shared/types'
import { normalizeExt } from '@shared/convert'

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

// Image targets where -quality is a real lossy dial.
const LOSSY_TARGETS = ['.jpg', '.webp', '.avif', '.jxl']

/**
 * The magick quality flags for a convert target. `-quality` is only a lossy
 * dial for jpg/webp/avif/jxl; for PNG it encodes zlib-level + filter-type, and
 * the shipped preset (82) produced the LARGEST output of the three (measured:
 * q82 1.75 MB vs 1.01 MB plain). PNG gets max deflate instead; gif/bmp/ico/
 * tiff have no meaningful dial and get nothing.
 */
export function magickQualityArgs(targetExt: string, quality: unknown): string[] {
  const e = normalizeExt(targetExt)
  if (LOSSY_TARGETS.includes(e)) {
    const q = qualityNum(quality)
    return q != null ? ['-quality', String(q)] : []
  }
  if (e === '.png') return ['-define', 'png:compression-level=9']
  return []
}

// Audio containers that can carry an attached-picture stream via stream copy.
const COVER_ART_EXTS = ['.mp3', '.m4a', '.flac']

/**
 * Stream mapping for an audio encode: always take the audio, carry embedded
 * cover art across UN-re-encoded when the target container holds one, and drop
 * it otherwise. Without an explicit map, ffmpeg treats the cover as a video
 * stream to re-encode: a JPEG cover became a PNG that made a "compressed" MP3
 * three times its source's size, and an h264-coded cover made every M4A encode
 * fail outright ("Could not find tag for codec h264").
 */
export function audioMapArgs(outputExt: string): string[] {
  const base = ['-map', '0:a']
  return COVER_ART_EXTS.includes(normalizeExt(outputExt))
    ? [...base, '-map', '0:v?', '-c:v', 'copy']
    : base
}

// Single-pass palette GIF: cap the frame rate, bound the width, generate and
// apply a per-clip palette. Bare defaults produced ~75 MB/minute of 720p GIF
// at measurably WORSE fidelity (SSIM 0.9501 vs 0.9786 with the palette pass).
const GIF_FILTER =
  "[0:v]fps=12,scale='min(480,iw)':-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse"

/**
 * Per-target ffmpeg args for a media convert. The bare `-y -i in out` default
 * was measured to be wrong for most targets: it drops every audio track but
 * the first and all subtitles (no -map), encodes AVI at mpeg4's worst
 * quantizer (q=31), runs VP9 at cpu-used 0 (0.66x realtime), and writes
 * palette-less GIFs. Subtitles are kept only where they can be stream-copied
 * (MKV); converting image subs (PGS) to mov_text fails the whole job, so
 * MP4/MOV take video + all audio and leave subs behind.
 */
export function ffmpegExtraFor(kind: FileKind, targetExt: string): string[] {
  const e = normalizeExt(targetExt)
  if (kind === 'audio') return audioMapArgs(e)
  if (kind !== 'video') return []
  if (e === '.gif') return ['-an', '-filter_complex', GIF_FILTER]
  if (e === '.webm')
    return [
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '32',
      '-b:v',
      '0',
      '-row-mt',
      '1',
      '-cpu-used',
      '4',
      '-c:a',
      'libopus'
    ]
  if (e === '.avi')
    return ['-map', '0:v:0', '-map', '0:a?', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame']
  if (e === '.mkv') return ['-map', '0:v:0', '-map', '0:a?', '-map', '0:s?', '-c:s', 'copy']
  // mp4 / mov: default encoders (libx264 + aac) are right; keep all audio.
  return ['-map', '0:v:0', '-map', '0:a?']
}
