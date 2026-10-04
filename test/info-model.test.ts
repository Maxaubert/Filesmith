import { describe, expect, it } from 'vitest'
import { infoRows, previewRows, wipeStep } from '../src/renderer/src/components/inspector/infoModel'
import type { QueueItem } from '../src/renderer/src/state'

const base: QueueItem = {
  id: 'a',
  file: { path: 'C:/p/a.jpg', name: 'a.jpg', ext: '.jpg', kind: 'image', size: 2_202_010 },
  thumb: null,
  status: 'ready',
  percent: 0
}
const done: QueueItem = { ...base, status: 'done', outputPath: 'C:/p/a.webp', outputSize: 497_664 }

describe('previewRows', () => {
  it('shows size, saved and pixels for a done file', () => {
    expect(previewRows(done, { width: 4032, height: 3024 })).toEqual([
      { k: 'size', v: '2.1 MB to 486 KB' },
      { k: 'saved', v: '1.6 MB, -77%' },
      { k: 'pixels', v: '4032 × 3024' }
    ])
  })
  it('omits saved before the file is done and says unknown without a probe', () => {
    expect(previewRows(base, null)).toEqual([
      { k: 'size', v: '2.1 MB' },
      { k: 'pixels', v: 'unknown' }
    ])
  })
})

describe('infoRows', () => {
  it('uses the word "to", never an arrow', () => {
    const rows = infoRows(done, { width: 10, height: 20 }, null)
    expect(rows.find((r) => r.k === 'format')?.v).toBe('jpg to webp')
    expect(rows.find((r) => r.k === 'output')).toEqual({
      k: 'output',
      v: 'C:/p/a.webp',
      reveal: 'C:/p/a.webp'
    })
    expect(rows.map((r) => r.v).join(' ')).not.toMatch(/→|->/)
  })
  it('shows the planned target before a run', () => {
    expect(infoRows(base, null, '.webp').find((r) => r.k === 'format')?.v).toBe('jpg to webp')
  })
  it('gives a failed row its full, selectable error', () => {
    const r = infoRows(
      { ...base, status: 'failed', error: 'Unsupported compression in TIFF' },
      null,
      null
    )
    expect(r.find((x) => x.k === 'error')).toEqual({
      k: 'error',
      v: 'Unsupported compression in TIFF',
      selectable: true
    })
  })
})

describe('wipeStep', () => {
  it('moves by 5 and clamps', () => {
    expect(wipeStep('ArrowRight', 50)).toBe(55)
    expect(wipeStep('ArrowLeft', 2)).toBe(0)
    expect(wipeStep('ArrowRight', 98)).toBe(100)
    expect(wipeStep('Home', 40)).toBe(0)
    expect(wipeStep('End', 40)).toBe(100)
    expect(wipeStep('a', 40)).toBeNull()
  })
})
