import { describe, expect, it } from 'vitest'
import { reducer, initialState, defaultOptionsFor, optionsKey } from '../src/renderer/src/state'
import type { FileInfo } from '../src/shared/types'

const img = (name: string): FileInfo => ({
  path: `C:/x/${name}`,
  name,
  ext: '.png',
  kind: 'image',
  size: 10
})
const pdf = (name: string): FileInfo => ({
  path: `C:/x/${name}`,
  name,
  ext: '.pdf',
  kind: 'pdf',
  size: 10
})

const CONVERT = 'convert'
const COMPRESS = 'compress'

const start = initialState

describe('per-verb queues', () => {
  it('keeps each verb queue separate: the queue belongs to what you are doing', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')], key: CONVERT })
    s = reducer(s, { type: 'setTab', tab: 'compress' })
    s = reducer(s, { type: 'addItems', files: [img('b.png')], key: COMPRESS })
    expect(s.queues[COMPRESS]!.items).toHaveLength(1)
    expect(s.queues[CONVERT]!.items).toHaveLength(1) // convert untouched
  })

  it('holds several convert groups in one queue at once', () => {
    // The whole point of the verb-first model: a Convert queue can carry images
    // and PDFs together, and the options panel scopes to whichever is selected.
    const s = reducer(start, {
      type: 'addItems',
      files: [img('a.png'), pdf('d.pdf')],
      key: CONVERT
    })
    expect(s.queues[CONVERT]!.items).toHaveLength(2)
    // Only the first group is auto-selected, so a batch is never cross-group.
    expect(s.queues[CONVERT]!.selected).toHaveLength(1)
  })

  it('gives each Tools card its own workspace queue', () => {
    let s = reducer(start, { type: 'setTab', tab: 'tools' })
    s = reducer(s, { type: 'setActiveTool', tool: 'pdf-merge' })
    s = reducer(s, { type: 'addItems', files: [pdf('a.pdf')], key: 'tools:pdf-merge' })
    s = reducer(s, { type: 'setActiveTool', tool: 'pdf-burst' })
    expect(s.queues['tools:pdf-merge']!.items).toHaveLength(1)
    expect(s.queues['tools:pdf-burst']!.items).toHaveLength(0)
  })

  it('routes a job event to whichever queue holds the item', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')], key: CONVERT })
    const id = s.queues[CONVERT]!.items[0].id
    s = reducer(s, { type: 'setTab', tab: 'resize' })
    s = reducer(s, { type: 'jobEvent', event: { id, status: 'done', outputPath: 'C:/x/a.webp' } })
    const items = s.queues[CONVERT]!.items
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe(id)
    expect(items[0].status).toBe('done')
    expect(items[0].isResult).toBeFalsy()
    expect(items[1].isResult).toBe(true)
    expect(items[1].outputPath).toBe('C:/x/a.webp')
  })

  it('appends a fresh result on each finished run; the source persists', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')], key: CONVERT })
    const id = s.queues[CONVERT]!.items[0].id
    s = reducer(s, {
      type: 'jobEvent',
      event: { id, status: 'done', outputPath: 'C:/x/a (1).webp' }
    })
    s = reducer(s, {
      type: 'jobEvent',
      event: { id, status: 'done', outputPath: 'C:/x/a (2).webp' }
    })
    const items = s.queues[CONVERT]!.items
    expect(items.filter((i) => !i.isResult)).toHaveLength(1)
    const results = items.filter((i) => i.isResult)
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.outputPath)).toEqual(['C:/x/a (1).webp', 'C:/x/a (2).webp'])
  })

  it('addSources appends pre-built input rows and selects them', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')], key: CONVERT })
    const clone = {
      id: 'clone-1',
      file: img('a.png'),
      thumb: null,
      status: 'ready' as const,
      percent: 0
    }
    s = reducer(s, { type: 'addSources', items: [clone], key: CONVERT })
    expect(s.queues[CONVERT]!.items.filter((i) => !i.isResult)).toHaveLength(2)
    expect(s.queues[CONVERT]!.selected).toEqual(['clone-1'])
  })
})

describe('navigation', () => {
  it('opens on the first verb, with no chooser in between', () => {
    expect(initialState.tab).toBe('convert')
    expect(initialState.activeTool).toBeNull()
  })

  it('returns to the Tools card you last had open', () => {
    let s = reducer(initialState, { type: 'setTab', tab: 'tools' })
    s = reducer(s, { type: 'setActiveTool', tool: 'pdf-burst' })
    s = reducer(s, { type: 'setTab', tab: 'convert' })
    expect(s.activeTool).toBeNull()
    s = reducer(s, { type: 'setTab', tab: 'tools' })
    expect(s.activeTool).toBe('pdf-burst')
  })

  it('keeps options per convert group inside one verb', () => {
    // Set an image target, then a video target: one Convert tab holds both, and
    // neither overwrites the other.
    let s = reducer(initialState, {
      type: 'setOption',
      group: 'image',
      key: 'format',
      value: '.avif'
    })
    s = reducer(s, { type: 'setOption', group: 'video', key: 'format', value: '.mkv' })
    expect(s.options[optionsKey('convert', null, 'image')].format).toBe('.avif')
    expect(s.options[optionsKey('convert', null, 'video')].format).toBe('.mkv')
  })

  it('seeds a group with its engine tool defaults', () => {
    const s = reducer(initialState, { type: 'setTab', tab: 'compress' })
    const s2 = reducer(s, { type: 'setOption', group: 'image', key: 'scale', value: 50 })
    expect(s2.options[optionsKey('compress', null, 'image')].quality).toBe(80)
  })

  it('carries a tool card verb into its options, since one tool serves several', () => {
    // "Burst" and "Merge" are both the pdf tool; the op key is what separates them.
    expect(defaultOptionsFor('tools', 'pdf-burst', 'doc').op).toBe('split-pages')
    expect(defaultOptionsFor('tools', 'pdf-merge', 'doc').op).toBe('merge')
    // Converting an image is the plain convert tool, so it carries no verb.
    expect(defaultOptionsFor('convert', null, 'image').op).toBeUndefined()
    // Converting an ARCHIVE is the archive tool with op 'repack', on the same tab.
    expect(defaultOptionsFor('convert', null, 'archive').op).toBe('repack')
  })
})
