import type { FormatOption } from './convert'

// Comic archives are ordinary containers with a renamed extension: .cbz is a
// zip, .cbr a rar, .cb7 a 7z, .cbt a tar. Converting between them is
// extract-and-repack, so the only thing that varies is the container 7-Zip is
// told to write. Shared with the renderer so the target chips it draws and the
// formats the engine accepts can never drift apart.
export type ArchiveContainer = 'zip' | '7z' | 'tar' | 'rar'

export const CONTAINER_OF: Record<string, ArchiveContainer> = {
  '.cbz': 'zip',
  '.zip': 'zip',
  '.cb7': '7z',
  '.7z': '7z',
  '.cbt': 'tar',
  '.tar': 'tar',
  '.cbr': 'rar',
  '.rar': 'rar'
}

// Comic formats first: they are the reason this category exists.
export const ARCHIVE_FORMATS: FormatOption[] = [
  { label: 'CBZ', ext: '.cbz' },
  { label: 'CBR', ext: '.cbr' },
  { label: 'CB7', ext: '.cb7' },
  { label: 'CBT', ext: '.cbt' },
  { label: 'ZIP', ext: '.zip' },
  { label: 'RAR', ext: '.rar' },
  { label: '7Z', ext: '.7z' },
  { label: 'TAR', ext: '.tar' }
]

/** The comic containers, the only sensible targets when packing rendered PDF
 * pages (nobody wants a .tar of page scans). */
export const COMIC_FORMATS: FormatOption[] = ARCHIVE_FORMATS.filter((f) =>
  ['.cbz', '.cbr', '.cb7', '.cbt'].includes(f.ext)
)

const norm = (ext: string): string => (ext.startsWith('.') ? ext : '.' + ext).toLowerCase()

export function containerOf(ext: string): ArchiveContainer | null {
  return CONTAINER_OF[norm(ext)] ?? null
}

/** True when writing this format requires WinRAR's Rar.exe, which cannot be
 * bundled: it is proprietary, and 7-Zip's unRAR licence forbids using its RAR
 * code to build a compressor. Reading a rar needs none of this. */
export function needsRar(ext: string): boolean {
  return containerOf(ext) === 'rar'
}

/** Targets offered for a source archive: everything but its own format, with
 * RAR formats removed when WinRAR is not installed. */
export function archiveTargets(sourceExt: string, hasRar: boolean): FormatOption[] {
  const src = norm(sourceExt)
  return ARCHIVE_FORMATS.filter((f) => f.ext !== src && (hasRar || !needsRar(f.ext)))
}
