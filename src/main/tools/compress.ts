import { extname } from 'path'
import { isLosslessAudio, normalizeExt } from '@shared/convert'
import { SCALE_MAX, SCALE_MIN, type AudioCodec, type VideoCodec } from '@shared/compress'

// Image targets that hold multiple frames — keep all frames (an animated GIF
// compressed to WebP/AVIF stays animated). Every other target is single-frame,
// so a multi-frame source is read as `input[0]` (else magick splits into
// out-0/out-1 and the exact output path stays empty).
const MULTIFRAME_TARGETS = ['.gif', '.tiff', '.webp', '.avif']

// Compression argument builders. No Electron. The runner (registry.ts) picks a
// path by kind: CaesiumCLT for its image formats, ImageMagick for other images
// (and for image-format conversion), ffmpeg for video/audio, mutool/gs for PDF.

/** Image formats CaesiumCLT can actually decode/encode (normalized exts).
 * TIFF is deliberately absent: CaesiumCLT fails on it ("Unable to compute the
 * base path for the files"), verified against the bundled binary, so TIFFs fall
 * through to the ImageMagick path instead. */
export const CAESIUM_EXTS = ['.jpg', '.png', '.webp', '.gif']

/** CaesiumCLT image compress: keep EXIF (-e), quality, output dir, input.
 * CaesiumCLT mirrors the input filename into -o, so callers write to a temp dir
 * and move the single result to a collision-safe name. */
export function buildCompressArgs(input: string, outDir: string, quality: number): string[] {
  return ['-e', '-q', String(quality), '-o', outDir, input]
}

/** ImageMagick image compress / format conversion — the output extension decides
 * the target format (webp/avif/…); `-quality` drives lossy encoding. A
 * single-frame target reads only `input[0]` (so a multi-frame source doesn't
 * split); a multi-frame target keeps every frame (animated GIF -> animated WebP). */
export function buildMagickCompressArgs(input: string, output: string, quality: number): string[] {
  const src = MULTIFRAME_TARGETS.includes(normalizeExt(extname(output))) ? input : `${input}[0]`
  return [src, '-quality', String(quality), output]
}

// --- Video ---------------------------------------------------------------------

const VIDEO_ENCODER: Record<VideoCodec, string> = {
  h264: 'libx264',
  h265: 'libx265',
  av1: 'libsvtav1'
}

/**
 * Slider 10..100 -> CRF, per codec (the CRF scale differs by codec). x264/x265
 * use ~18-32; SVT-AV1 uses a higher range (~28-50) for comparable quality.
 */
export function crfForCodec(codec: VideoCodec, quality: number): number {
  const q = Math.max(10, Math.min(100, quality))
  const [lo, hi] = codec === 'av1' ? [28, 50] : [18, 32]
  return Math.round(hi - ((q - 10) * (hi - lo)) / 90)
}

export interface VideoOpts {
  codec: VideoCodec
  quality: number
  /** Output size as a percentage of the source (100 = original). */
  scale: number
}

/**
 * ffmpeg video compress. Output is always MP4 (H.264/H.265/AV1 all mux there);
 * the chosen codec drives the encoder and CRF. Scaling is a percentage of the
 * source, computed by ffmpeg itself (`iw*S`), with even dimensions
 * (`force_divisible_by=2`) — aspect ratio is preserved for any shape and no
 * probe is needed. Audio -> AAC 128k.
 */
export function buildVideoCompressArgs(input: string, output: string, o: VideoOpts): string[] {
  const args = ['-y', '-i', input]
  if (o.scale < 100) {
    const s = Math.max(SCALE_MIN, Math.min(SCALE_MAX, o.scale)) / 100
    args.push('-vf', `scale=w=iw*${s}:h=ih*${s}:force_divisible_by=2`)
  }
  args.push('-c:v', VIDEO_ENCODER[o.codec])
  args.push('-preset', o.codec === 'av1' ? '6' : 'medium')
  args.push('-crf', String(crfForCodec(o.codec, o.quality)))
  if (o.codec === 'h265') args.push('-tag:v', 'hvc1') // Apple/QuickTime compatibility
  args.push('-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart')
  args.push(output)
  return args
}

// --- Audio ---------------------------------------------------------------------

const AUDIO_ENCODER: Record<Exclude<AudioCodec, 'keep'>, string> = {
  mp3: 'libmp3lame',
  aac: 'aac',
  opus: 'libopus'
}
// For "keep", re-encode in the source codec (mapped from its extension).
const EXT_ENCODER: Record<string, string> = {
  '.mp3': 'libmp3lame',
  '.m4a': 'aac',
  '.aac': 'aac',
  '.ogg': 'libvorbis',
  '.opus': 'libopus',
  '.wma': 'wmav2'
}
// The output extension for a chosen codec (keep -> source ext).
const CODEC_EXT: Record<Exclude<AudioCodec, 'keep'>, string> = {
  mp3: '.mp3',
  aac: '.m4a',
  opus: '.opus'
}

/**
 * Output extension for an audio compress: the target codec's container, or the
 * source extension when keeping the codec. "Keep" on a LOSSLESS source (wav /
 * aiff / flac) becomes FLAC — a bitrate is meaningless there, so the honest
 * "keep every sample but make it smaller" answer is max-compression FLAC
 * (a WAV typically drops ~40-50%).
 */
export function audioOutputExt(codec: AudioCodec, sourceExt: string): string {
  if (codec !== 'keep') return CODEC_EXT[codec]
  return isLosslessAudio(sourceExt) ? '.flac' : normalizeExt(sourceExt)
}

export interface AudioOpts {
  codec: AudioCodec
  bitrate: number
  sourceExt: string
}

/** ffmpeg audio compress to a target codec + bitrate (kbps), or lossless FLAC
 * when keeping the format of a lossless source. */
export function buildAudioCompressArgs(input: string, output: string, o: AudioOpts): string[] {
  if (o.codec === 'keep' && isLosslessAudio(o.sourceExt)) {
    return ['-y', '-i', input, '-c:a', 'flac', '-compression_level', '8', output]
  }
  const enc =
    o.codec === 'keep' ? (EXT_ENCODER[normalizeExt(o.sourceExt)] ?? 'aac') : AUDIO_ENCODER[o.codec]
  return ['-y', '-i', input, '-c:a', enc, '-b:a', `${o.bitrate}k`, output]
}
