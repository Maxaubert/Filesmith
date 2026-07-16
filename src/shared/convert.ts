import type { FileKind } from './types'

// Convert catalogs + rules, shared by the engine and the UI so they never drift.
// Convert works WITHIN a file kind (image↔image, audio↔audio, video↔video); you
// cannot convert across kinds, and you cannot convert a file to its own format.

export interface FormatOption {
  label: string
  ext: string // lowercased, leading dot
}

export const IMAGE_FORMATS: FormatOption[] = [
  { label: 'PNG', ext: '.png' },
  { label: 'JPG', ext: '.jpg' },
  { label: 'WebP', ext: '.webp' },
  { label: 'AVIF', ext: '.avif' },
  { label: 'JXL', ext: '.jxl' },
  { label: 'TIFF', ext: '.tiff' },
  { label: 'BMP', ext: '.bmp' },
  { label: 'GIF', ext: '.gif' },
  { label: 'ICO', ext: '.ico' }
]

export const VIDEO_FORMATS: FormatOption[] = [
  { label: 'MP4', ext: '.mp4' },
  { label: 'MKV', ext: '.mkv' },
  { label: 'MOV', ext: '.mov' },
  { label: 'WebM', ext: '.webm' },
  { label: 'AVI', ext: '.avi' },
  { label: 'GIF', ext: '.gif' }
]

export const AUDIO_FORMATS: FormatOption[] = [
  { label: 'MP3', ext: '.mp3' },
  { label: 'M4A', ext: '.m4a' },
  { label: 'AAC', ext: '.aac' },
  { label: 'OGG', ext: '.ogg' },
  { label: 'OPUS', ext: '.opus' },
  { label: 'FLAC', ext: '.flac' },
  { label: 'WAV', ext: '.wav' }
]

/** All formats offered for a kind (before excluding the source's own). */
export function categoryFormats(kind: FileKind): FormatOption[] {
  if (kind === 'image') return IMAGE_FORMATS
  if (kind === 'video') return VIDEO_FORMATS
  if (kind === 'audio') return AUDIO_FORMATS
  return []
}

/** Fold alias extensions so .tif == .tiff and .jpeg == .jpg. */
export function normalizeExt(ext: string): string {
  const e = (ext.startsWith('.') ? ext : '.' + ext).toLowerCase()
  if (e === '.tif') return '.tiff'
  if (e === '.jpeg') return '.jpg'
  return e
}

/** True when a→b would be a no-op (same format, alias-aware). */
export function isSameFormat(a: string, b: string): boolean {
  return normalizeExt(a) === normalizeExt(b)
}

/** Target formats for a source of the given kind, dropping the source's own format. */
export function convertTargets(kind: FileKind, srcExt: string): FormatOption[] {
  return categoryFormats(kind).filter((f) => !isSameFormat(f.ext, srcExt))
}

/** A sensible default target for a source (first valid, non-same format). */
export function defaultTargetExt(kind: FileKind, srcExt: string): string | null {
  const t = convertTargets(kind, srcExt)
  return t.length ? t[0].ext : null
}

/** Which external tool converts this kind (or null if unsupported). */
export function toolForKind(kind: FileKind): 'magick' | 'ffmpeg' | null {
  if (kind === 'image') return 'magick'
  if (kind === 'video' || kind === 'audio') return 'ffmpeg'
  return null
}

const ICO_EXTRA = ['-define', 'icon:auto-resize=256,128,64,48,32,16']

/** Extra ImageMagick flags for a given target ext (multi-size ICO). */
export function magickExtraFor(ext: string): string[] {
  return normalizeExt(ext) === '.ico' ? ICO_EXTRA : []
}
