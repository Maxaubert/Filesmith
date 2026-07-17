import { normalizeExt } from '@shared/convert'

// Compression argument builders. No Electron. The runner (registry.ts) picks a
// path by kind: CaesiumCLT for its image formats, ImageMagick for other images,
// ffmpeg for video/audio, mutool for PDF.

/** Image formats CaesiumCLT can actually decode/encode (normalized exts). */
export const CAESIUM_EXTS = ['.jpg', '.png', '.webp', '.gif', '.tiff']

/** CaesiumCLT image compress: keep EXIF (-e), quality, output dir, input.
 * CaesiumCLT mirrors the input filename into -o, so callers write to a temp dir
 * and move the single result to a collision-safe name. */
export function buildCompressArgs(input: string, outDir: string, quality: number): string[] {
  return ['-e', '-q', String(quality), '-o', outDir, input]
}

/** ImageMagick fallback for image formats CaesiumCLT can't read. */
export function buildMagickCompressArgs(input: string, output: string, quality: number): string[] {
  return [input, '-quality', String(quality), output]
}

/** Slider 10..100 -> x264/VP9 CRF (lower CRF = higher quality). q100->18, q10->32. */
export function crfForQuality(quality: number): number {
  const q = Math.max(10, Math.min(100, quality))
  return Math.round(18 + ((100 - q) * (32 - 18)) / 90)
}

/**
 * ffmpeg video compress with FIXED encoders (ffprobe isn't bundled, so we never
 * try to keep the source codec). WebM -> VP9/Opus; everything else -> H.264/AAC
 * in MP4 (universally playable, faststart for web).
 */
export function buildVideoCompressArgs(
  input: string,
  output: string,
  quality: number,
  webm: boolean
): string[] {
  const crf = String(crfForQuality(quality))
  const v = webm
    ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', crf, '-c:a', 'libopus', '-b:a', '128k']
    : [
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        crf,
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart'
      ]
  return ['-y', '-i', input, ...v, output]
}

/** Slider 10..100 -> audio bitrate kbps. q10->64k, q100->256k. */
export function kbpsForQuality(quality: number): number {
  const q = Math.max(10, Math.min(100, quality))
  return Math.round(64 + ((q - 10) / 90) * (256 - 64))
}

const AUDIO_CODEC: Record<string, string> = {
  '.mp3': 'libmp3lame',
  '.m4a': 'aac',
  '.aac': 'aac',
  '.ogg': 'libvorbis',
  '.opus': 'libopus',
  '.wma': 'wmav2'
}

/** ffmpeg audio compress: re-encode to a target bitrate keeping the format. */
export function buildAudioCompressArgs(
  input: string,
  output: string,
  quality: number,
  ext: string
): string[] {
  const codec = AUDIO_CODEC[normalizeExt(ext)] ?? 'aac'
  return ['-y', '-i', input, '-c:a', codec, '-b:a', `${kbpsForQuality(quality)}k`, output]
}
