import { describe, expect, it } from 'vitest'
import { familyFormats, routeConvert, sharedTargets } from '@shared/convert'
import { initialState, reducer } from '../src/renderer/src/state'

// Archive <-> PDF are ordinary Converts to a user, so they live on the Convert
// tab rather than hiding in Tools. Only the engine routing differs.

const exts = (f: { ext: string }[]): string[] => f.map((x) => x.ext)

describe('cross-group convert targets', () => {
  it('offers comic containers for a PDF source', () => {
    const t = exts(familyFormats('pdf', '.pdf'))
    expect(t).toContain('.cbz')
    expect(t).toContain('.cb7')
    // ...without losing the document targets it has always had.
    expect(t).toContain('.docx')
    expect(t).toContain('.txt')
  })

  it('offers PDF for an archive source, alongside the other containers', () => {
    const t = exts(familyFormats('archive', '.cbz'))
    expect(t).toContain('.pdf')
    expect(t).toContain('.cb7')
    expect(t).toContain('.zip')
  })

  it('does NOT offer comic containers for a docx in the same doc group', () => {
    const t = exts(familyFormats('document', '.docx'))
    expect(t).not.toContain('.cbz')
    expect(t).toContain('.pdf')
  })

  it('offers only what EVERY selected source can do', () => {
    // A pdf alone can become a CBZ; a pdf next to a docx cannot, because the
    // docx has no such conversion and Run acts on the whole selection.
    expect(exts(sharedTargets('pdf', ['.pdf']))).toContain('.cbz')
    expect(exts(sharedTargets('pdf', ['.pdf', '.docx']))).not.toContain('.cbz')
    expect(exts(sharedTargets('pdf', ['.pdf', '.docx']))).toContain('.txt')
  })

  it('returns nothing when nothing is selected', () => {
    expect(sharedTargets('image', [])).toEqual([])
  })
})

describe('routeConvert', () => {
  it('sends archive to archive through repack', () => {
    expect(routeConvert('archive', '.cbz', '.cb7')).toEqual({ tool: 'archive', op: 'repack' })
    expect(routeConvert('archive', '.rar', '.zip')).toEqual({ tool: 'archive', op: 'repack' })
  })

  it('sends archive to PDF through to-pdf', () => {
    expect(routeConvert('archive', '.cbz', '.pdf')).toEqual({ tool: 'archive', op: 'to-pdf' })
  })

  it('sends PDF to a comic container through from-pdf', () => {
    expect(routeConvert('pdf', '.pdf', '.cbz')).toEqual({ tool: 'archive', op: 'from-pdf' })
    expect(routeConvert('pdf', '.pdf', '.cb7')).toEqual({ tool: 'archive', op: 'from-pdf' })
  })

  it('leaves ordinary conversions on the convert tool', () => {
    expect(routeConvert('pdf', '.pdf', '.docx')).toEqual({ tool: 'convert' })
    expect(routeConvert('image', '.png', '.webp')).toEqual({ tool: 'convert' })
    expect(routeConvert('document', '.docx', '.pdf')).toEqual({ tool: 'convert' })
  })
})

describe('switching route seeds its settings', () => {
  it('a PDF aimed at a comic archive gains DPI and page settings', () => {
    // The bag was written by the convert tool and has never held a DPI. The
    // archive engine reads one, so setting the verb must seed it.
    let s = reducer(initialState, { type: 'setOption', group: 'doc', key: 'format', value: '.cbz' })
    expect(s.options['convert:doc'].dpi).toBeUndefined()
    s = reducer(s, { type: 'setOption', group: 'doc', key: 'op', value: 'from-pdf' })
    expect(s.options['convert:doc'].op).toBe('from-pdf')
    expect(s.options['convert:doc'].dpi).toBe(150)
    expect(s.options['convert:doc'].pageFormat).toBe('jpg')
    // pageQuality, not quality: convert stores a preset STRING under `quality`,
    // and Number('balanced') is NaN.
    expect(s.options['convert:doc'].pageQuality).toBe(100)
  })

  it('never overwrites a setting the user already chose', () => {
    let s = reducer(initialState, { type: 'setOption', group: 'doc', key: 'dpi', value: 300 })
    s = reducer(s, { type: 'setOption', group: 'doc', key: 'op', value: 'from-pdf' })
    expect(s.options['convert:doc'].dpi).toBe(300)
  })

  it('keeps the chosen target when the verb changes', () => {
    let s = reducer(initialState, { type: 'setOption', group: 'doc', key: 'format', value: '.cbz' })
    s = reducer(s, { type: 'setOption', group: 'doc', key: 'op', value: 'from-pdf' })
    expect(s.options['convert:doc'].format).toBe('.cbz')
  })
})
