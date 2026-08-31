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
  '.mpo',
  '.ico'
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
// Office/binary documents LibreOffice converts (word, spreadsheet, slides).
export const DOC_EXTS = [
  '.docx',
  '.doc',
  '.odt',
  '.rtf',
  '.xlsx',
  '.xls',
  '.ods',
  '.csv',
  '.tsv',
  '.pptx',
  '.ppt',
  '.odp'
  // .epub omitted: LibreOffice has no epub import filter, so every epub
  // conversion would fail. Add back only with a real epub reader.
]
// Plain-text / markup / code — previewed as text, converted as documents.
export const TEXT_EXTS = [
  '.txt',
  '.md',
  '.markdown',
  '.rst',
  '.log',
  '.json',
  '.xml',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.py',
  '.cs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.go',
  '.rs',
  '.sh'
]

// Archive containers, including the comic variants (.cbz/.cbr/.cb7/.cbt are
// zip/rar/7z/tar with a renamed extension). Compound extensions (.tar.gz) are
// deliberately out: FileInfo.ext is a single lowercased extension.
export const ARCHIVE_EXTS = ['.zip', '.rar', '.7z', '.tar', '.cbz', '.cbr', '.cb7', '.cbt']

/** Classify a file by its extension (lowercased, with or without a leading dot). */
export function fileKind(ext: string): FileKind {
  const e = (ext.startsWith('.') ? ext : '.' + ext).toLowerCase()
  if (e === '.pdf') return 'pdf'
  if (IMAGE_EXTS.includes(e)) return 'image'
  if (VIDEO_EXTS.includes(e)) return 'video'
  if (AUDIO_EXTS.includes(e)) return 'audio'
  if (ARCHIVE_EXTS.includes(e)) return 'archive'
  if (TEXT_EXTS.includes(e)) return 'text'
  if (DOC_EXTS.includes(e)) return 'document'
  return 'other'
}

/** The last path segment, for display. Hand-rolled five times before (one of
 * which - a forward-slash-only regex fed Windows paths - was a real bug). */
export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}
