// test/row-menu.test.ts
import { describe, expect, it } from 'vitest'
import {
  deleteConfirm,
  menuTargets,
  removeConfirm,
  revealPath,
  rowMenuModel,
  type RowMenuAction,
  type RowMenuEntry
} from '../src/renderer/src/components/queue/rowMenu'
import type { QueueItem } from '../src/renderer/src/state'

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: over.id ?? 'a',
  file: { path: 'C:/x/a.png', name: 'a.png', ext: '.png', kind: 'image', size: 1000 },
  thumb: null,
  status: 'ready',
  percent: 0,
  ...over
})

type Live = Exclude<RowMenuEntry, { sep: true }>
const entries = (m: RowMenuEntry[]): Live[] => m.filter((e): e is Live => !e.sep)
const get = (m: RowMenuEntry[], a: RowMenuAction): Live => entries(m).find((e) => e.action === a)!
const enabled = (m: RowMenuEntry[]): RowMenuAction[] =>
  entries(m)
    .filter((e) => !e.disabled)
    .map((e) => e.action)

describe('menuTargets', () => {
  it('acts on the whole selection when the clicked row is in it', () => {
    expect(menuTargets('b', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })
  it('acts on the clicked row alone when it is not selected', () => {
    expect(menuTargets('d', ['a', 'b'])).toEqual(['d'])
    expect(menuTargets('d', [])).toEqual(['d'])
  })
})

describe('rowMenuModel', () => {
  it('keeps one fixed order with separators', () => {
    const m = rowMenuModel([item()], [item()])
    expect(m.map((e) => (e.sep ? '-' : e.action))).toEqual([
      'open',
      'reveal',
      '-',
      'retry',
      'stop',
      '-',
      'clear',
      '-',
      'remove',
      'delete'
    ])
  })

  it('a single ready file can be opened, shown, removed and deleted', () => {
    const a = item()
    expect(enabled(rowMenuModel([a], [a]))).toEqual(['open', 'reveal', 'remove', 'delete'])
    expect(get(rowMenuModel([a], [a]), 'remove').label).toBe('Remove from list')
    expect(get(rowMenuModel([a], [a]), 'delete').label).toBe('Delete file')
  })

  it('a multi-selection cannot Open or Show, and counts in its labels', () => {
    const rows = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })]
    const m = rowMenuModel(rows, rows)
    expect(get(m, 'open').disabled).toBe(true)
    expect(get(m, 'reveal').disabled).toBe(true)
    expect(get(m, 'remove').label).toBe('Remove 3 from list')
    expect(get(m, 'delete').label).toBe('Delete 3 files')
  })

  it('Retry needs a failed or canceled row; Stop needs one in flight', () => {
    const rows = [
      item({ id: 'a', status: 'failed' }),
      item({ id: 'b', status: 'canceled' }),
      item({ id: 'c', status: 'running' })
    ]
    const m = rowMenuModel(rows, rows)
    expect(get(m, 'retry')).toMatchObject({ disabled: false, label: 'Retry 2 files' })
    expect(get(m, 'stop')).toMatchObject({ disabled: false, label: 'Stop' })
    const idle = rowMenuModel([item({ status: 'done' })], [])
    expect(get(idle, 'retry').disabled).toBe(true)
    expect(get(idle, 'stop').disabled).toBe(true)
  })

  it('Delete waits until a running job is stopped', () => {
    const rows = [item({ id: 'a' }), item({ id: 'b', status: 'queued' })]
    expect(get(rowMenuModel(rows, rows), 'delete').disabled).toBe(true)
    expect(get(rowMenuModel(rows, rows), 'remove').disabled).toBe(false)
  })

  it('Clear finished looks at the whole queue, not the targets', () => {
    const a = item({ id: 'a' })
    const done = item({ id: 'b', status: 'done' })
    expect(get(rowMenuModel([a], [a]), 'clear').disabled).toBe(true)
    expect(get(rowMenuModel([a], [a, done]), 'clear').disabled).toBe(false)
    // A dismissed or result row is not "on the list" to clear.
    const hidden = item({ id: 'c', status: 'done', hiddenInput: true })
    const result = item({ id: 'd', status: 'done', isResult: true, outputPath: 'C:/x/a.webp' })
    expect(get(rowMenuModel([a], [a, hidden, result]), 'clear').disabled).toBe(true)
  })

  it('only Delete is styled as danger', () => {
    const m = entries(rowMenuModel([item()], [item()]))
    expect(m.filter((e) => e.danger).map((e) => e.action)).toEqual(['delete'])
  })
})

describe('revealPath', () => {
  it('shows the result once done, else the source', () => {
    expect(revealPath(item())).toBe('C:/x/a.png')
    expect(revealPath(item({ status: 'done', outputPath: 'C:/x/a.webp' }))).toBe('C:/x/a.webp')
    expect(revealPath(item({ status: 'failed', outputPath: 'C:/x/a.webp' }))).toBe('C:/x/a.png')
  })
})

describe('confirm copy', () => {
  it('names the count and the Recycle Bin', () => {
    expect(deleteConfirm(3).title).toBe('Delete 3 files?')
    expect(deleteConfirm(3).body).toMatch(/3 source files go to the Recycle Bin/)
    expect(deleteConfirm(1).body).toMatch(/source file goes to the Recycle Bin/)
    expect(removeConfirm(2).title).toBe('Remove 2 files from the list?')
    expect(removeConfirm(1).body).toMatch(/not touched/)
  })
  it('never uses an em-dash', () => {
    for (const n of [1, 4])
      for (const c of [deleteConfirm(n), removeConfirm(n)])
        expect(c.title + c.body).not.toMatch(/\u2014/)
  })
})
