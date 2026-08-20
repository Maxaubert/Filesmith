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

// Document families, all converted via LibreOffice. Targets depend on the
// source's sub-type (word / spreadsheet / slides / pdf / plain-text).
const WORD_FORMATS: FormatOption[] = [
  { label: 'PDF', ext: '.pdf' },
  { label: 'DOCX', ext: '.docx' },
  { label: 'ODT', ext: '.odt' },
  { label: 'RTF', ext: '.rtf' },
  { label: 'TXT', ext: '.txt' },
  { label: 'HTML', ext: '.html' }
]
const SHEET_FORMATS: FormatOption[] = [
  { label: 'PDF', ext: '.pdf' },
  { label: 'XLSX', ext: '.xlsx' },
  { label: 'ODS', ext: '.ods' },
  { label: 'CSV', ext: '.csv' }
]
const SLIDE_FORMATS: FormatOption[] = [
  { label: 'PDF', ext: '.pdf' },
  { label: 'PPTX', ext: '.pptx' },
  { label: 'ODP', ext: '.odp' }
]
const SHEET_EXTS = ['.xlsx', '.xls', '.ods', '.csv', '.tsv']
const SLIDE_EXTS = ['.pptx', '.ppt', '.odp']

// Word docs, plain text, and PDF all share the full document format set, so any
// of them can convert to any other (docx<->pdf<->txt<->rtf<->odt<->html).
// Spreadsheets and slides keep their own natural targets.
function docFormats(srcExt: string): FormatOption[] {
  const e = normalizeExt(srcExt)
  if (SHEET_EXTS.includes(e)) return SHEET_FORMATS
  if (SLIDE_EXTS.includes(e)) return SLIDE_FORMATS
  return WORD_FORMATS
}

/** All formats offered for a kind (image/video/audio ignore srcExt). */
export function categoryFormats(kind: FileKind): FormatOption[] {
  if (kind === 'image') return IMAGE_FORMATS
  if (kind === 'video') return VIDEO_FORMATS
  if (kind === 'audio') return AUDIO_FORMATS
  return []
}

/** Full format family for a source, including its own format (for the UI grid
 * that greys out the source's own). Document families need the source ext. */
export function familyFormats(kind: FileKind, srcExt: string): FormatOption[] {
  if (kind === 'document' || kind === 'pdf' || kind === 'text') return docFormats(srcExt)
  return categoryFormats(kind)
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
  return familyFormats(kind, srcExt).filter((f) => !isSameFormat(f.ext, srcExt))
}

/** A sensible default target for a source (first valid, non-same format). */
export function defaultTargetExt(kind: FileKind, srcExt: string): string | null {
  const t = convertTargets(kind, srcExt)
  return t.length ? t[0].ext : null
}

/**
 * The batch-conversion group a file belongs to: files in the same group share a
 * target-format set and can be multi-selected + converted together. Word docs,
 * plain text, and PDF all share one 'doc' group; spreadsheets and slides get
 * their own (their targets differ).
 */
export function convertGroup(kind: FileKind, ext: string): string {
  if (kind === 'image' || kind === 'video' || kind === 'audio') return kind
  const e = normalizeExt(ext)
  if (SHEET_EXTS.includes(e)) return 'sheet'
  if (SLIDE_EXTS.includes(e)) return 'slide'
  return 'doc'
}

// Lossless / raw audio. These CAN be compressed (re-encoding a FLAC or WAV to
// Opus is a huge win), but "keep the same codec at a bitrate" is meaningless for
// them, so the engine gives them a lossless-FLAC path instead.
export const LOSSLESS_AUDIO_EXTS = ['.flac', '.wav', '.aiff', '.aif']

// Image formats the compressors can actually re-encode: CaesiumCLT's set plus
// the raster formats ImageMagick re-encodes at a quality target. Vector/layered/
// exotic exts (svg, xcf, tga, ppm, mpo) are excluded — "compress to same ext"
// there would silently rasterize into a broken file that still passes a size>0
// check, so they must not be offered.
// HEIC/HEIF are absent for the same reason as the vector formats: the bundled
// magick has no HEIC ENCODER, prints "no encode delegate" as a warning, exits
// 0, and leaves a junk file wearing a .heic name. BMP is absent because BMP is
// uncompressed - a "compress" that changes nothing at every quality is a lie.
export const COMPRESSIBLE_IMAGE_EXTS = ['.jpg', '.png', '.webp', '.gif', '.tiff', '.avif', '.jxl']

/** Whether the Compress tool supports a given file. Images: only formats the
 * compressors handle (Caesium set + raster magick); video, audio and PDF always
 * (lossless audio re-encodes to a lossy codec, or to max-compression FLAC). */
export function canCompress(kind: FileKind, ext: string): boolean {
  const e = normalizeExt(ext)
  if (kind === 'image') return COMPRESSIBLE_IMAGE_EXTS.includes(e)
  if (kind === 'video' || kind === 'pdf' || kind === 'audio') return true
  return false
}

/** True for raw/lossless audio, where a bitrate target makes no sense. */
export function isLosslessAudio(ext: string): boolean {
  return LOSSLESS_AUDIO_EXTS.includes(normalizeExt(ext))
}

/** Which external tool converts this kind (or null if unsupported). */
export function toolForKind(kind: FileKind): 'magick' | 'ffmpeg' | 'soffice' | null {
  if (kind === 'image') return 'magick'
  if (kind === 'video' || kind === 'audio') return 'ffmpeg'
  if (kind === 'document' || kind === 'pdf' || kind === 'text') return 'soffice'
  return null
}

const ICO_EXTRA = ['-define', 'icon:auto-resize=256,128,64,48,32,16']
// Targets with no alpha channel — flatten transparency onto white so a
// transparent PNG/GIF doesn't come out with a black background.
const NO_ALPHA = ['.jpg', '.bmp']
const FLATTEN = ['-background', 'white', '-alpha', 'remove', '-alpha', 'off']

/** Extra ImageMagick flags for a given target ext (multi-size ICO, alpha flatten). */
export function magickExtraFor(ext: string): string[] {
  const e = normalizeExt(ext)
  if (e === '.ico') return ICO_EXTRA
  if (NO_ALPHA.includes(e)) return FLATTEN
  return []
}
