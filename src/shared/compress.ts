// Compress-tool option catalogs, shared by the renderer (option pickers) and the
// engine (argument builders) so they never drift. Labels use the same
// "compatible / smaller / smallest" framing across every media kind.

// Option labels stand on their own: no parenthetical descriptions, no hint
// lines. The choice names say what they do.
export interface Choice<T extends string> {
  value: T
  label: string
}

// --- Images: keep the source format, or convert (lossy) to a smaller one -------
export type ImageFormat = 'keep' | 'webp' | 'avif'
export const IMAGE_FORMATS: Choice<ImageFormat>[] = [
  { value: 'keep', label: 'Keep format' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' }
]

// --- Video: codec + resolution -------------------------------------------------
export type VideoCodec = 'h264' | 'h265' | 'av1'
export const VIDEO_CODECS: Choice<VideoCodec>[] = [
  { value: 'h264', label: 'H.264' },
  { value: 'h265', label: 'H.265' },
  { value: 'av1', label: 'AV1' }
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
  { value: 'keep', label: 'Keep format' },
  { value: 'mp3', label: 'MP3' },
  { value: 'aac', label: 'AAC' },
  { value: 'opus', label: 'Opus' }
]
export const AUDIO_BITRATES = [320, 256, 192, 128, 96, 64] as const

// --- Image upscaling (Real-ESRGAN) ---------------------------------------------
// AI upscaling, deliberately its own tool rather than part of Resize: it invents
// plausible detail rather than interpolating, needs a GPU, and takes seconds per
// image, so it has nothing in common with "make this 800px wide".
// 'photo'/'anime' run on the bundled cross-GPU Real-ESRGAN. 'pid' is the
// NVIDIA-only diffusion flagship (a separate on-demand engine); the UI only
// offers it when an NVIDIA GPU is present.
// 'photo'/'anime' run on the bundled cross-GPU Real-ESRGAN. 'pid' is the
// NVIDIA-only diffusion flagship (kept in the engine; not shown in the picker).
// 'comfy' is the "ComfyUI models" category (reveals a sub-picker); a specific
// imported model is 'comfy:<abs-path>' (NVIDIA/spandrel).
// 'photo'/'anime' are the legacy aliases existing sessions store; a model
// discovered on disk is 'esrgan:<basename>'. Which models exist is read from the
// models folder at runtime, not frozen at build time.
export type UpscaleModel =
  | 'photo'
  | 'anime'
  | 'pid'
  | 'comfy'
  | `comfy:${string}`
  | `esrgan:${string}`
export const UPSCALE_MODELS: Choice<UpscaleModel>[] = [
  { value: 'photo', label: 'Photo' },
  { value: 'anime', label: 'Anime' }
]
/** The NVIDIA-only diffusion flagship. Retained for the engine; not currently
 * offered in the picker (superseded by imported ComfyUI models). */
export const UPSCALE_PID: Choice<UpscaleModel> = { value: 'pid', label: 'PiD (NVIDIA, best)' }
/** The "AI models" category entry, shown only when a GPU is detected. It reveals
 * a second picker of every AI upscaler — imported ComfyUI models plus PiD. */
export const UPSCALE_COMFY: Choice<UpscaleModel> = { value: 'comfy', label: 'AI models' }

export type UpscaleFactor = 2 | 3 | 4
export const UPSCALE_FACTORS: UpscaleFactor[] = [2, 3, 4]

// How much of the GPU an upscale is allowed to take. 'full' runs flat-out;
// 'background' caps VRAM and paces the work so the GPU stays responsive for other
// apps (games, ComfyUI), trading speed for headroom. Only meaningful for the
// tiled engines (Real-ESRGAN, ComfyUI/spandrel) — PiD's diffusion can't be paced.
export type UpscaleGpuMode = 'full' | 'background'
export const UPSCALE_GPU_MODES: Choice<UpscaleGpuMode>[] = [
  { value: 'full', label: 'Full GPU usage' },
  { value: 'background', label: 'Balanced' }
]

/** Output pixel size for a scale factor (for the live preview list). */
export function upscaledSize(w: number, h: number, factor: number): { w: number; h: number } {
  return { w: Math.round(w * factor), h: Math.round(h * factor) }
}

/**
 * There is no hard ceiling on upscaling: if someone wants a preposterously large
 * image, that's their call. Past this estimated output size we warn once and let
 * them decide.
 */
export const HUGE_OUTPUT_BYTES = 1024 ** 3 // 1 GB

/**
 * Rough PNG size for an upscaled result. Measured, not guessed: a 4000x3000
 * source at 4x (192 MP) produced a 195 MB PNG, i.e. ~1.02 bytes per pixel.
 * Round up slightly, since detailed photos compress worse than the test image.
 */
export function estimatedPngBytes(w: number, h: number): number {
  return Math.round(w * h * 1.2)
}

/** "8.3 GB" / "410 MB" — for the oversize warning. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

// --- PDF: compression level (+ optional grayscale) -----------------------------
export type PdfLevel = 'lossless' | 'high' | 'balanced' | 'smallest'
export const PDF_LEVELS: Choice<PdfLevel>[] = [
  { value: 'lossless', label: 'Lossless' },
  { value: 'high', label: 'High quality' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'smallest', label: 'Smallest' }
]
