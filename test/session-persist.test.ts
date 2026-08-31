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
      convert: {
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
    const items = parsed!.state.queues.convert!.items
    // Thumb dropped (reloadable), running settled back to ready.
    expect(items[0].thumb).toBeNull()
    expect(items[0].status).toBe('ready')
    expect(items[0].percent).toBe(0)
    // The produced result and its output path survive.
    expect(items[1].isResult).toBe(true)
    expect(items[1].outputPath).toBe('C:/out/a (converted).png')
    expect(parsed!.genResults).toEqual(['C:/gen/one.png'])
  })

  it('rejects junk, but never a merely older session', () => {
    expect(parseSession(null)).toBeNull()
    expect(parseSession('garbage')).toBeNull()
    // A v1 blob is MIGRATED, not discarded: its files are the user's in-flight
    // work, and losing them to an upgrade is worse than resetting settings.
    expect(parseSession({ version: 1 })).not.toBeNull()
    // A version from the future (a downgrade) takes the same path and yields an
    // empty but usable session rather than crashing the window.
    const snap = sessionSnapshot(initialState, []) as Record<string, unknown>
    const future = parseSession({ ...snap, version: 999 })
    expect(future).not.toBeNull()
    expect(future!.state.tab).toBe('convert')
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
    const ids = pruned.state.queues.convert!.items.map((i) => i.id)
    expect(ids).toEqual(['a', 'c']) // b (source gone) and d (output gone) dropped
    expect(pruned.genResults).toEqual(['C:/gen/keep.png'])
    // Selection/anchor are cleared on prune so they can't dangle.
    expect(pruned.state.queues.convert!.selected).toEqual([])
  })

  it('always launches into the first verb, whatever was open at close', () => {
    const state: AppState = { ...initialState, tab: 'compress' }
    const parsed = parseSession(sessionSnapshot(state, []))
    expect(parsed).not.toBeNull()
    expect(parsed!.state.tab).toBe('convert')
  })

  it('remembers the Tools card that was last open', () => {
    const state: AppState = { ...initialState, tab: 'tools', lastTool: 'pdf-burst' }
    const parsed = parseSession(sessionSnapshot(state, []))
    expect(parsed!.state.tab).toBe('convert')
    expect(parsed!.state.lastTool).toBe('pdf-burst')
  })

  it('forgets a Tools card that no longer exists', () => {
    const state: AppState = { ...initialState, lastTool: 'renamed-away' }
    const parsed = parseSession(sessionSnapshot(state, []))
    expect(parsed!.state.lastTool).toBeNull()
  })
})
