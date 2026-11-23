import { describe, expect, it } from 'vitest'
import {
  reducer,
  initialState,
  emptyQueue,
  optionsKey,
  type Action,
  type AppState,
  type QueueItem
} from '../src/renderer/src/state'
import type { FileInfo } from '../src/shared/types'

const img = (name: string): FileInfo => ({
  path: `C:/x/${name}`,
  name,
  ext: '.png',
  kind: 'image',
  size: 10
})

const src = (id: string, extra: Partial<QueueItem> = {}): QueueItem => ({
  id,
  file: img(`${id}.png`),
  thumb: null,
  status: 'ready',
  percent: 0,
  ...extra
})

const result = (id: string, outputPath: string): QueueItem => ({
  id,
  file: img(`${id}.png`),
  thumb: null,
  status: 'done',
  percent: 100,
  outputPath,
  outputSize: 5,
  isResult: true
})

/** Convert holds a and b, compress holds c; the user is on compress. */
function twoTabs(): AppState {
  return {
    ...initialState,
    tab: 'compress',
    queues: {
      convert: { items: [src('a'), src('b')], selected: ['a', 'b'], anchor: 'b' },
      compress: { items: [src('c')], selected: ['c'], anchor: 'c' }
    }
  }
}

describe('post-await actions find the owning queue', () => {
  it('dismiss removes an item that lives in another tab queue', () => {
    const s0 = twoTabs()
    const s = reducer(s0, { type: 'dismiss', id: 'a', column: 'input' })
    expect(s.queues.convert!.items.map((i) => i.id)).toEqual(['b'])
    expect(s.queues.convert!.selected).toEqual(['b'])
    expect(s.queues.compress).toBe(s0.queues.compress)
  })

  it('markQueued resets an item in another queue and leaves the current one alone', () => {
    const s0 = twoTabs()
    s0.queues.convert!.items[0] = src('a', { status: 'failed', error: 'x', outputPath: 'C:/o.png' })
    const s = reducer(s0, { type: 'markQueued', ids: ['a'], options: { quality: 50 } })
    const a = s.queues.convert!.items[0]
    expect(a.status).toBe('queued')
    expect(a.error).toBeUndefined()
    expect(a.outputPath).toBeUndefined()
    expect(a.runOptions).toEqual({ quality: 50 })
    expect(s.queues.compress).toBe(s0.queues.compress)
  })
})

describe('selection pruning is the same for dismiss, dismissAny and hideFinished', () => {
  const base = (): AppState => ({
    ...initialState,
    queues: {
      convert: {
        items: [src('a', { status: 'done' }), src('b')],
        selected: ['a', 'b'],
        anchor: 'a'
      }
    }
  })
  const cases: [string, Action][] = [
    ['dismiss', { type: 'dismiss', id: 'a', column: 'input' }],
    ['dismissAny', { type: 'dismissAny', ids: ['a'], column: 'input' }],
    ['hideFinished', { type: 'hideFinished' }]
  ]
  for (const [name, action] of cases) {
    it(name, () => {
      const q = reducer(base(), action).queues.convert!
      expect(q.items.map((i) => i.id)).toEqual(['b'])
      expect(q.selected).toEqual(['b'])
      expect(q.anchor).toBeNull()
    })
  }
})

describe('deleting a result clears the stale path on its source', () => {
  it('clears outputPath and outputSize when the last result goes', () => {
    const s0: AppState = {
      ...initialState,
      queues: {
        convert: {
          items: [
            src('a', { status: 'done', outputPath: 'C:/o.webp', outputSize: 5 }),
            result('r1', 'C:/o.webp')
          ],
          selected: [],
          anchor: null
        }
      }
    }
    const s = reducer(s0, { type: 'dismissAny', ids: ['r1'], column: 'output' })
    const a = s.queues.convert!.items.find((i) => i.id === 'a')!
    expect(a.outputPath).toBeUndefined()
    expect(a.outputSize).toBeUndefined()
    expect(a.status).toBe('done')
  })

  it('keeps it while another visible result has the same path', () => {
    const s0: AppState = {
      ...initialState,
      queues: {
        convert: {
          items: [
            src('a', { status: 'done', outputPath: 'C:/o.webp', outputSize: 5 }),
            result('r1', 'C:/o.webp'),
            result('r2', 'C:/o.webp')
          ],
          selected: [],
          anchor: null
        }
      }
    }
    const s = reducer(s0, { type: 'dismissAny', ids: ['r1'], column: 'output' })
    expect(s.queues.convert!.items.find((i) => i.id === 'a')!.outputPath).toBe('C:/o.webp')
  })
})

describe('hydrate keeps live state changed during the restore', () => {
  const restored = (): AppState => ({
    ...initialState,
    lastTool: null,
    queues: { convert: { items: [src('old')], selected: [], anchor: null } },
    options: {
      [optionsKey('convert', null, 'image')]: { format: '.jpg', quality: 'small', keepDates: false }
    }
  })

  it('keeps a tab switched before hydrate', () => {
    const live = reducer(initialState, { type: 'setTab', tab: 'compress' })
    const s = reducer(live, { type: 'hydrate', state: restored() })
    expect(s.tab).toBe('compress')
    expect(s.queues.compress).toEqual(emptyQueue())
    expect(s.queues.convert!.items.map((i) => i.id)).toEqual(['old'])
  })

  it('keeps an option set before hydrate and restores the untouched ones', () => {
    const live = reducer(initialState, {
      type: 'setOption',
      group: 'image',
      key: 'format',
      value: '.avif'
    })
    const s = reducer(live, { type: 'hydrate', state: restored() })
    expect(s.options[optionsKey('convert', null, 'image')]).toEqual({
      format: '.avif',
      quality: 'small',
      keepDates: false
    })
  })

  it('still merges files dropped before hydrate', () => {
    const live = reducer(initialState, {
      type: 'addItems',
      files: [img('new.png')],
      key: 'convert'
    })
    const s = reducer(live, { type: 'hydrate', state: restored() })
    expect(s.queues.convert!.items.map((i) => i.file.name)).toEqual(['old.png', 'new.png'])
  })
})
