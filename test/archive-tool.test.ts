import { describe, expect, it } from 'vitest'
import { needsRar } from '@shared/archive'
import { IMAGE_ENTRY_EXTS, naturalSort } from '../src/main/tools/archive'
import { getTool } from '../src/main/tools/registry'

// The spawn behaviour is covered end to end in e2e/workflows.spec.ts. These pin
// the decisions the tool makes before it spawns anything.
describe('archive tool', () => {
  it('is registered under the archive id', () => {
    expect(getTool('archive')).toBeDefined()
  })

  it('rejects an unknown operation instead of guessing', async () => {
    const tool = getTool('archive')!
    await expect(
      tool.run(
        { path: 'C:\\x.cbz', name: 'x.cbz', ext: '.cbz', kind: 'archive', size: 1 },
        { op: 'nonsense' },
        { signal: new AbortController().signal, onProgress: () => {} }
      )
    ).rejects.toThrow(/Unknown archive operation/)
  })

  it('treats a rar target as needing WinRAR', () => {
    expect(needsRar('.cbr')).toBe(true)
  })

  it('selects page images by extension in natural order', () => {
    const entries = ['cover.png', 'p10.jpg', 'p2.jpg', 'notes.txt', 'thumbs.db']
    const pages = naturalSort(
      entries.filter((e) => IMAGE_ENTRY_EXTS.some((x) => e.toLowerCase().endsWith(x)))
    )
    expect(pages).toEqual(['cover.png', 'p2.jpg', 'p10.jpg'])
  })
})
