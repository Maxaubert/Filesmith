import { describe, expect, it } from 'vitest'
import { archiveTargets, containerOf, needsRar, ARCHIVE_FORMATS } from '@shared/archive'

describe('archive catalog', () => {
  it('maps every comic extension to its real container', () => {
    expect(containerOf('.cbz')).toBe('zip')
    expect(containerOf('.cbr')).toBe('rar')
    expect(containerOf('.cb7')).toBe('7z')
    expect(containerOf('.cbt')).toBe('tar')
    expect(containerOf('.zip')).toBe('zip')
    expect(containerOf('.7z')).toBe('7z')
    expect(containerOf('.tar')).toBe('tar')
    expect(containerOf('.rar')).toBe('rar')
  })

  it('returns null for a non-archive extension', () => {
    expect(containerOf('.png')).toBeNull()
  })

  it('offers eight formats in total', () => {
    expect(ARCHIVE_FORMATS).toHaveLength(8)
  })

  it('drops the source format from the target list', () => {
    const exts = archiveTargets('.cbz', true).map((f) => f.ext)
    expect(exts).not.toContain('.cbz')
    expect(exts).toContain('.cb7')
  })

  it('drops rar targets when WinRAR is absent', () => {
    const without = archiveTargets('.cbz', false).map((f) => f.ext)
    expect(without).not.toContain('.cbr')
    expect(without).not.toContain('.rar')
    const withRar = archiveTargets('.cbz', true).map((f) => f.ext)
    expect(withRar).toContain('.cbr')
    expect(withRar).toContain('.rar')
  })

  it('knows which extensions need WinRAR', () => {
    expect(needsRar('.cbr')).toBe(true)
    expect(needsRar('.rar')).toBe(true)
    expect(needsRar('.cbz')).toBe(false)
  })

  it('is case-insensitive on the source extension', () => {
    expect(archiveTargets('.CBZ', true).map((f) => f.ext)).not.toContain('.cbz')
  })
})
