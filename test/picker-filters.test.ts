import { describe, expect, it } from 'vitest'
import { imageFilters, pickerFilters } from '../src/main/pickerFilters'
import {
  ARCHIVE_EXTS,
  AUDIO_EXTS,
  DOC_EXTS,
  IMAGE_EXTS,
  TEXT_EXTS,
  VIDEO_EXTS,
  fileKind
} from '@shared/fileKind'

// The Archives category shipped once with the Open dialog still refusing to
// list a .cbz: "All supported" was a hand-written union that nobody extended.
// These assert the filters against the extension sets themselves, so the next
// category cannot drift the same way.

const all = (): string[] => pickerFilters()[0].extensions
const named = (name: string): string[] =>
  pickerFilters().find((f) => f.name === name)?.extensions ?? []

describe('open dialog filters', () => {
  it('offers every category as its own filter', () => {
    expect(pickerFilters().map((f) => f.name)).toEqual([
      'All supported',
      'Images',
      'Video',
      'Audio',
      'Documents',
      'Text',
      'Archives'
    ])
  })

  it('lists archives, so a .cbz is selectable in the picker', () => {
    expect(named('Archives')).toContain('cbz')
    expect(named('Archives')).toContain('cbr')
    expect(named('Archives').sort()).toEqual(ARCHIVE_EXTS.map((e) => e.slice(1)).sort())
  })

  it('"All supported" covers every extension the app can classify', () => {
    const every = [
      ...IMAGE_EXTS,
      ...VIDEO_EXTS,
      ...AUDIO_EXTS,
      '.pdf',
      ...DOC_EXTS,
      ...TEXT_EXTS,
      ...ARCHIVE_EXTS
    ]
    for (const ext of every) {
      expect(fileKind(ext), ext).not.toBe('other')
      expect(all(), ext).toContain(ext.slice(1))
    }
  })

  it('strips only the leading dot (.7z keeps its digit)', () => {
    expect(named('Archives')).toContain('7z')
    expect(named('Archives')).not.toContain('.7z')
  })

  it('the image picker offers images only', () => {
    expect(imageFilters()).toHaveLength(1)
    expect(imageFilters()[0].extensions.sort()).toEqual(IMAGE_EXTS.map((e) => e.slice(1)).sort())
  })
})
