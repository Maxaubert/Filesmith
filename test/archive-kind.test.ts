import { describe, expect, it } from 'vitest'
import { ARCHIVE_EXTS, fileKind } from '@shared/fileKind'

describe('archive file kind', () => {
  it('classifies every archive extension as archive', () => {
    for (const e of ARCHIVE_EXTS) expect(fileKind(e)).toBe('archive')
  })

  it('covers the eight supported extensions', () => {
    expect([...ARCHIVE_EXTS].sort()).toEqual(
      ['.7z', '.cb7', '.cbr', '.cbt', '.cbz', '.rar', '.tar', '.zip'].sort()
    )
  })

  it('accepts an extension without a leading dot, and any case', () => {
    expect(fileKind('cbz')).toBe('archive')
    expect(fileKind('.CBR')).toBe('archive')
  })

  it('leaves other kinds alone', () => {
    expect(fileKind('.png')).toBe('image')
    expect(fileKind('.pdf')).toBe('pdf')
    expect(fileKind('.xyz')).toBe('other')
  })
})
