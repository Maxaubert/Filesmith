import { describe, expect, it } from 'vitest'
import {
  groupedRows,
  nextSort,
  sortItems,
  visibleOrder
} from '../src/renderer/src/components/queue/tableSort'
import type { QueueItem } from '../src/renderer/src/state'

const it_ = (
  id: string,
  name: string,
  ext: string,
  size: number,
  over: Partial<QueueItem> = {}
): QueueItem => ({
  id,
  file: { path: `C:/x/${name}`, name, ext, kind: ext === '.mp4' ? 'video' : 'image', size },
  thumb: null,
  status: 'ready',
  percent: 0,
  ...over
})

describe('nextSort', () => {
  it('cycles ascending, descending, off', () => {
    const a = nextSort(null, 'size')
    expect(a).toEqual({ key: 'size', dir: 'asc' })
    const b = nextSort(a, 'size')
    expect(b).toEqual({ key: 'size', dir: 'desc' })
    expect(nextSort(b, 'size')).toBeNull()
  })
  it('starts ascending when switching column', () => {
    expect(nextSort({ key: 'size', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })
})

describe('sortItems', () => {
  const rows = [
    it_('1', 'b.png', '.png', 30),
    it_('2', 'a.png', '.png', 10),
    it_('3', 'c.jpg', '.jpg', 20)
  ]
  it('keeps insertion order when off and never mutates', () => {
    const copy = [...rows]
    expect(sortItems(rows, null).map((r) => r.id)).toEqual(['1', '2', '3'])
    sortItems(rows, { key: 'size', dir: 'asc' })
    expect(rows).toEqual(copy)
  })
  it('sorts by name, size and kind', () => {
    expect(sortItems(rows, { key: 'name', dir: 'asc' }).map((r) => r.id)).toEqual(['2', '1', '3'])
    expect(sortItems(rows, { key: 'size', dir: 'desc' }).map((r) => r.id)).toEqual(['1', '3', '2'])
    expect(sortItems(rows, { key: 'kind', dir: 'asc' }).map((r) => r.id)).toEqual(['3', '1', '2'])
  })
  it('sorts by result size with empty results last', () => {
    const r = [
      it_('1', 'a.png', '.png', 10),
      it_('2', 'b.png', '.png', 10, { status: 'done', outputSize: 5 }),
      it_('3', 'c.png', '.png', 10, { status: 'done', outputSize: 2 })
    ]
    expect(sortItems(r, { key: 'result', dir: 'asc' }).map((x) => x.id)).toEqual(['3', '2', '1'])
    expect(sortItems(r, { key: 'result', dir: 'desc' }).map((x) => x.id)).toEqual(['2', '3', '1'])
  })
  it('sorts by status with failures first', () => {
    const r = [
      it_('1', 'a.png', '.png', 1, { status: 'done' }),
      it_('2', 'b.png', '.png', 1, { status: 'failed' }),
      it_('3', 'c.png', '.png', 1, { status: 'running' })
    ]
    expect(sortItems(r, { key: 'status', dir: 'asc' }).map((x) => x.id)).toEqual(['2', '3', '1'])
  })
})

describe('groupedRows', () => {
  it('sorts within each group and keeps groups in display order', () => {
    const g = groupedRows(
      [it_('v', 'z.mp4', '.mp4', 99), it_('2', 'b.png', '.png', 2), it_('1', 'a.png', '.png', 1)],
      { key: 'name', dir: 'asc' }
    )
    expect(g.map((x) => x.group)).toEqual(['image', 'video'])
    expect(visibleOrder(g)).toEqual(['1', '2', 'v'])
  })
  it('skips hidden inputs and results', () => {
    const g = groupedRows(
      [
        it_('1', 'a.png', '.png', 1, { hiddenInput: true }),
        it_('2', 'b.png', '.png', 1, { isResult: true })
      ],
      null
    )
    expect(g).toEqual([])
  })
})
