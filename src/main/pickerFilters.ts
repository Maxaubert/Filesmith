import {
  ARCHIVE_EXTS,
  AUDIO_EXTS,
  DOC_EXTS,
  IMAGE_EXTS,
  TEXT_EXTS,
  VIDEO_EXTS
} from '@shared/fileKind'

/** Electron's dialog filters want bare extensions ("png"), not ".png". */
const bare = (exts: string[]): string[] => exts.map((e) => e.replace(/^\./, ''))

export interface PickerFilter {
  name: string
  extensions: string[]
}

/**
 * The Open dialog's filter list. Split out of ipc.ts so it can be tested: this
 * list was silently missing a whole category once (archives shipped as a
 * category while the picker still refused to show a .cbz), and the only thing
 * that catches that is asserting the filters against the extension sets.
 */
export function pickerFilters(): PickerFilter[] {
  const everything = [
    ...IMAGE_EXTS,
    ...VIDEO_EXTS,
    ...AUDIO_EXTS,
    '.pdf',
    ...DOC_EXTS,
    ...TEXT_EXTS,
    ...ARCHIVE_EXTS
  ]
  return [
    { name: 'All supported', extensions: bare(everything) },
    { name: 'Images', extensions: bare(IMAGE_EXTS) },
    { name: 'Video', extensions: bare(VIDEO_EXTS) },
    { name: 'Audio', extensions: bare(AUDIO_EXTS) },
    { name: 'Documents', extensions: bare(['.pdf', ...DOC_EXTS]) },
    { name: 'Text', extensions: bare(TEXT_EXTS) },
    { name: 'Archives', extensions: bare(ARCHIVE_EXTS) }
  ]
}

/** Just the image filter, for the Remove Background backdrop picker. */
export function imageFilters(): PickerFilter[] {
  return [{ name: 'Images', extensions: bare(IMAGE_EXTS) }]
}
