// Compress-tool option catalogs, shared by the renderer (option pickers) and the
// engine (argument builders) so they never drift. Labels use the same
// "compatible / smaller / smallest" framing across every media kind.

export interface Choice<T extends string> {
  value: T
  label: string
  sub?: string
}

// --- Images: keep the source format, or convert (lossy) to a smaller one -------
export type ImageFormat = 'keep' | 'webp' | 'avif'
export const IMAGE_FORMATS: Choice<ImageFormat>[] = [
  { value: 'keep', label: 'Keep format', sub: 'baseline' },
  { value: 'webp', label: 'WebP', sub: 'compatible' },
  { value: 'avif', label: 'AVIF', sub: 'smallest' }
]

// --- Video: codec + resolution -------------------------------------------------
export type VideoCodec = 'h264' | 'h265' | 'av1'
export const VIDEO_CODECS: Choice<VideoCodec>[] = [
  { value: 'h264', label: 'H.264', sub: 'compatible' },
  { value: 'h265', label: 'H.265', sub: 'smaller' },
  { value: 'av1', label: 'AV1', sub: 'smallest' }
]

// Video is scaled by a PERCENTAGE, not by named presets. A label like "720p" is
// a lie for anything that isn't 16:9 (an ultrawide "720p" is 1280x540), and it
// means different things per file in a multi-selection. A percentage is honest
// for any aspect ratio and any number of files; the options panel shows the
// exact resulting pixels per file next to it.
export const SCALE_MIN = 25
export const SCALE_MAX = 100
export const SCALE_STEP = 5

/**
 * The actual output WxH after scaling by `pct` percent, preserving aspect ratio.
 * Both dimensions are rounded to even numbers (required by most codecs), which
 * matches ffmpeg's `force_divisible_by=2`.
 */
export function scaleResolution(w: number, h: number, pct: number): { w: number; h: number } {
  const s = Math.max(SCALE_MIN, Math.min(SCALE_MAX, pct)) / 100
  if (s >= 1 || w <= 0 || h <= 0) return { w, h }
  const even = (n: number): number => Math.max(2, Math.round((n * s) / 2) * 2)
  return { w: even(w), h: even(h) }
}

// --- Audio: codec + bitrate ----------------------------------------------------
export type AudioCodec = 'keep' | 'mp3' | 'aac' | 'opus'
export const AUDIO_CODECS: Choice<AudioCodec>[] = [
  { value: 'keep', label: 'Keep format', sub: 'same codec' },
  { value: 'mp3', label: 'MP3', sub: 'compatible' },
  { value: 'aac', label: 'AAC', sub: 'balanced' },
  { value: 'opus', label: 'Opus', sub: 'smallest' }
]
export const AUDIO_BITRATES = [320, 256, 192, 128, 96, 64] as const

// --- PDF: compression level (+ optional grayscale) -----------------------------
export type PdfLevel = 'lossless' | 'high' | 'balanced' | 'smallest'
export const PDF_LEVELS: Choice<PdfLevel>[] = [
  { value: 'lossless', label: 'Lossless', sub: 'structure only' },
  { value: 'high', label: 'High quality', sub: '~300 dpi' },
  { value: 'balanced', label: 'Balanced', sub: '~150 dpi' },
  { value: 'smallest', label: 'Smallest', sub: '~72 dpi' }
]
