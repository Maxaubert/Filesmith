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
    expect(s.queues.convert.items[0].status).toBe('done')
    expect(s.queues.convert.items[0].outputPath).toBe('C:/x/a.webp')
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
