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

// Six presets fill a clean 3-column grid (2 rows). 1440p is intentionally
// omitted — for a "make it smaller" tool, 1080p is the sensible cap for 4K
// sources and it keeps the control compact.
export type VideoResolution = 'original' | '1080p' | '720p' | '480p' | '360p' | '240p'
export const VIDEO_RESOLUTIONS: Choice<VideoResolution>[] = [
  { value: 'original', label: 'Original' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
  { value: '360p', label: '360p' },
  { value: '240p', label: '240p' }
]

// The bounding box each resolution preset fits WITHIN (keeping aspect ratio,
// never upscaling). Works for any shape — landscape, portrait, ultrawide.
export const RES_BOX: Record<Exclude<VideoResolution, 'original'>, [number, number]> = {
  '1080p': [1920, 1080],
  '720p': [1280, 720],
  '480p': [854, 480],
  '360p': [640, 360],
  '240p': [426, 240]
}

/**
 * Given a source WxH and a preset, the actual output WxH after a downscale-only
 * "fit within the box, preserve aspect ratio" resize. Returns the source size
 * unchanged for 'original' or when it already fits. Both dimensions are rounded
 * to even numbers (required by most codecs).
 */
export function fitResolution(
  w: number,
  h: number,
  res: VideoResolution
): { w: number; h: number } {
  if (res === 'original' || w <= 0 || h <= 0) return { w, h }
  const [bw, bh] = RES_BOX[res]
  const scale = Math.min(1, bw / w, bh / h) // never upscale
  const even = (n: number): number => Math.max(2, Math.round((n * scale) / 2) * 2)
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
