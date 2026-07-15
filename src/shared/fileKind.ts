import type { FileKind } from './types'

// Extension sets, ported from RCMM's Get-Category. Kept in shared so the
// renderer can classify dropped files (to highlight applicable tools) using
// the exact same rules the engine uses.
export const IMAGE_EXTS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.bmp',
  '.gif',
  '.webp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.avif',
  '.jxl',
  '.svg',
  '.tga',
  '.ppm',
  '.xcf',
  '.mpo'
]
export const VIDEO_EXTS = [
  '.mp4',
  '.mkv',
  '.mov',
  '.webm',
  '.avi',
  '.m4v',
  '.wmv',
  '.flv',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.3g2',
  '.vob',
  '.mxf',
  '.asf',
  '.ogv'
]
export const AUDIO_EXTS = [
  '.mp3',
  '.wav',
  '.flac',
  '.m4a',
  '.ogg',
  '.aac',
  '.wma',
  '.ac3',
  '.aiff',
  '.aif',
  '.amr'
]
export const DOC_EXTS = ['.docx', '.doc', '.odt', '.rtf', '.html', '.htm', '.md']

/** Classify a file by its extension (lowercased, with or without a leading dot). */
export function fileKind(ext: string): FileKind {
  const e = (ext.startsWith('.') ? ext : '.' + ext).toLowerCase()
  if (e === '.pdf') return 'pdf'
  if (IMAGE_EXTS.includes(e)) return 'image'
  if (VIDEO_EXTS.includes(e)) return 'video'
  if (AUDIO_EXTS.includes(e)) return 'audio'
  if (DOC_EXTS.includes(e)) return 'document'
  return 'other'
}
