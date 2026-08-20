import { describe, expect, it } from 'vitest'
import {
  initialState,
  parseSession,
  pruneMissing,
  sessionPaths,
  sessionSnapshot,
  type AppState,
  type QueueItem
} from '../src/renderer/src/state'

const fi = (path: string, kind = 'image' as const) => ({
  path,
  name: path.split(/[\\/]/).pop() ?? path,
  ext: '.png',
  kind,
  size: 1000
})

const source = (id: string, path: string): QueueItem => ({
  id,
  file: fi(path),
  thumb: 'data:image/png;base64,AAAA',
  status: 'ready',
  percent: 0
})

const result = (id: string, src: string, out: string): QueueItem => ({
  id,
  file: fi(src),
  thumb: null,
  status: 'done',
  percent: 100,
  isResult: true,
  outputPath: out,
  outputSize: 500
})

function stateWith(items: QueueItem[]): AppState {
  return {
    ...initialState,
    queues: {
      images: {
        items,
        selected: [items[0]?.id].filter(Boolean) as string[],
        anchor: items[0]?.id ?? null
      }
    }
  }
}

describe('session persistence round-trip', () => {
  it('snapshots and restores a session, stripping thumbs and settling in-flight items', () => {
    const running: QueueItem = {
      ...source('a', 'C:/in/a.png'),
      status: 'running',
      percent: 42,
      thumb: 'data:big'
    }
    const state = stateWith([running, result('b', 'C:/in/a.png', 'C:/out/a (converted).png')])
    const snap = sessionSnapshot(state, ['C:/gen/one.png'])
    const parsed = parseSession(snap)
    expect(parsed).not.toBeNull()
    const items = parsed!.state.queues.images!.items
    // Thumb dropped (reloadable), running settled back to ready.
    expect(items[0].thumb).toBeNull()
    expect(items[0].status).toBe('ready')
    expect(items[0].percent).toBe(0)
    // The produced result and its output path survive.
    expect(items[1].isResult).toBe(true)
    expect(items[1].outputPath).toBe('C:/out/a (converted).png')
    expect(parsed!.genResults).toEqual(['C:/gen/one.png'])
  })

  it('rejects a session with a mismatched version', () => {
    const snap = sessionSnapshot(initialState, []) as Record<string, unknown>
    expect(parseSession({ ...snap, version: 999 })).toBeNull()
    expect(parseSession(null)).toBeNull()
    expect(parseSession('garbage')).toBeNull()
    expect(parseSession({ version: 1 })).not.toBeNull() // tolerant of missing optional fields
  })

  it('collects every on-disk path referenced by the session', () => {
    const state = stateWith([
      source('a', 'C:/in/a.png'),
      result('b', 'C:/in/a.png', 'C:/out/b.png')
    ])
    const paths = sessionPaths(state, ['C:/gen/g.png'])
    expect(new Set(paths)).toEqual(new Set(['C:/in/a.png', 'C:/out/b.png', 'C:/gen/g.png']))
  })

  it('prunes items and generated results whose backing file is gone', () => {
    const state = stateWith([
      source('a', 'C:/in/present.png'),
      source('b', 'C:/in/gone.png'),
      result('c', 'C:/in/present.png', 'C:/out/present.png'),
      result('d', 'C:/in/present.png', 'C:/out/gone.png')
    ])
    const exists = new Set(['C:/in/present.png', 'C:/out/present.png', 'C:/gen/keep.png'])
    const pruned = pruneMissing(state, ['C:/gen/keep.png', 'C:/gen/gone.png'], exists)
    const ids = pruned.state.queues.images!.items.map((i) => i.id)
    expect(ids).toEqual(['a', 'c']) // b (source gone) and d (output gone) dropped
    expect(pruned.genResults).toEqual(['C:/gen/keep.png'])
    // Selection/anchor are cleared on prune so they can't dangle.
    expect(pruned.state.queues.images!.selected).toEqual([])
  })

  it('falls back to a valid category/operation when the persisted one is invalid', () => {
    const snap = sessionSnapshot(initialState, []) as Record<string, unknown>
    const parsed = parseSession({ ...snap, category: 'nonsense', operation: 'nope' })
    expect(parsed).not.toBeNull()
    expect(parsed!.state.category).toBe('images')
  })
})
