import { describe, expect, it } from 'vitest'
import { reducer, initialState } from '../src/renderer/src/state'
import type { FileInfo } from '../src/shared/types'

const img = (name: string): FileInfo => ({
  path: `C:/x/${name}`,
  name,
  ext: '.png',
  kind: 'image',
  size: 10
})

describe('per-tool queues', () => {
  it('adds items only to the active tool queue', () => {
    let s = reducer(initialState, { type: 'addItems', files: [img('a.png')] })
    expect(s.queues.convert.items).toHaveLength(1)
    expect(s.queues.compress.items).toHaveLength(0)

    s = reducer(s, { type: 'setTool', tool: 'compress' })
    s = reducer(s, { type: 'addItems', files: [img('b.png')] })
    expect(s.queues.compress.items).toHaveLength(1)
    expect(s.queues.convert.items).toHaveLength(1) // convert's history is untouched
  })

  it('keeps selection independent per tool', () => {
    let s = reducer(initialState, { type: 'addItems', files: [img('a.png')] })
    expect(s.queues.convert.selected).toHaveLength(1)
    s = reducer(s, { type: 'setTool', tool: 'compress' })
    expect(s.queues.compress.selected).toHaveLength(0)
  })

  it('routes a job event to whichever queue holds the item, even after a tab switch', () => {
    let s = reducer(initialState, { type: 'addItems', files: [img('a.png')] })
    const id = s.queues.convert.items[0].id
    s = reducer(s, { type: 'setTool', tool: 'resize' })
    s = reducer(s, {
      type: 'jobEvent',
      event: { id, status: 'done', outputPath: 'C:/x/a.webp' }
    })
    // A finished job appends a result item and marks the source done (checkmark),
    // keeping it re-runnable.
    const conv = s.queues.convert.items
    expect(conv).toHaveLength(2)
    expect(conv[0].id).toBe(id)
    expect(conv[0].status).toBe('done')
    expect(conv[0].isResult).toBeFalsy()
    expect(conv[1].isResult).toBe(true)
    expect(conv[1].status).toBe('done')
    expect(conv[1].outputPath).toBe('C:/x/a.webp')
  })

  it('appends a fresh result on each finished run; the source persists', () => {
    let s = reducer(initialState, { type: 'addItems', files: [img('a.png')] })
    const id = s.queues.convert.items[0].id
    s = reducer(s, { type: 'jobEvent', event: { id, status: 'done', outputPath: 'C:/x/a (1).webp' } })
    s = reducer(s, { type: 'jobEvent', event: { id, status: 'done', outputPath: 'C:/x/a (2).webp' } })
    const items = s.queues.convert.items
    expect(items.filter((i) => !i.isResult)).toHaveLength(1) // one source
    const results = items.filter((i) => i.isResult)
    expect(results).toHaveLength(2) // two accumulated outputs
    expect(results.map((r) => r.outputPath)).toEqual(['C:/x/a (1).webp', 'C:/x/a (2).webp'])
  })

  it('addSources appends pre-built input rows and selects them (per-run entries)', () => {
    let s = reducer(initialState, { type: 'addItems', files: [img('a.png')] })
    const clone = {
      id: 'clone-1',
      file: img('a.png'),
      thumb: null,
      status: 'ready' as const,
      percent: 0
    }
    s = reducer(s, { type: 'addSources', items: [clone] })
    // Two input rows for the same file (original + a run clone), no dedup.
    expect(s.queues.convert.items.filter((i) => !i.isResult)).toHaveLength(2)
    expect(s.queues.convert.selected).toEqual(['clone-1'])
  })

  it('dismissing in one tool does not touch another tool holding the same file', () => {
    let s = reducer(initialState, { type: 'addItems', files: [img('a.png')] })
    s = reducer(s, { type: 'setTool', tool: 'compress' })
    s = reducer(s, { type: 'addItems', files: [img('a.png')] })
    const compressId = s.queues.compress.items[0].id
    s = reducer(s, { type: 'dismiss', id: compressId, column: 'input' })
    expect(s.queues.compress.items).toHaveLength(0)
    expect(s.queues.convert.items).toHaveLength(1)
  })
})
