import { describe, expect, it } from 'vitest'
import { reducer, initialState, defaultOptionsFor, type AppState } from '../src/renderer/src/state'
import { workspaceKey } from '../src/shared/catalog'
import type { FileInfo } from '../src/shared/types'

const img = (name: string): FileInfo => ({
  path: `C:/x/${name}`,
  name,
  ext: '.png',
  kind: 'image',
  size: 10
})

const IMAGES = 'images' as const
const PDF = 'pdf' as const

/** Switch operation within the current category (the queue is shared). */
const open = (s: AppState, operation: string): AppState =>
  reducer(s, { type: 'setOperation', operation })

const start = open(initialState, 'convert')

describe('per-category queues (shared across operations)', () => {
  it('keeps files when switching operation within a category', () => {
    // The whole point: an image added while converting is still there after
    // switching to compress, because the queue belongs to the file type.
    let s = reducer(start, { type: 'addItems', files: [img('a.png')] })
    expect(s.queues[IMAGES]!.items).toHaveLength(1)
    s = open(s, 'compress')
    expect(s.queues[IMAGES]!.items).toHaveLength(1) // retained
    s = open(s, 'upscale')
    expect(s.queues[IMAGES]!.items).toHaveLength(1) // still retained
  })

  it('keeps each file type queue separate', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')] })
    s = reducer(s, { type: 'setCategory', category: 'pdf' })
    s = reducer(s, {
      type: 'addItems',
      files: [{ path: 'C:/x/d.pdf', name: 'd.pdf', ext: '.pdf', kind: 'pdf', size: 5 }]
    })
    expect(s.queues[PDF]!.items).toHaveLength(1)
    expect(s.queues[IMAGES]!.items).toHaveLength(1) // images untouched
  })

  it('routes a job event to whichever category queue holds the item', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')] })
    const id = s.queues[IMAGES]!.items[0].id
    s = open(s, 'resize')
    s = reducer(s, { type: 'jobEvent', event: { id, status: 'done', outputPath: 'C:/x/a.webp' } })
    const items = s.queues[IMAGES]!.items
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe(id)
    expect(items[0].status).toBe('done')
    expect(items[0].isResult).toBeFalsy()
    expect(items[1].isResult).toBe(true)
    expect(items[1].outputPath).toBe('C:/x/a.webp')
  })

  it('appends a fresh result on each finished run; the source persists', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')] })
    const id = s.queues[IMAGES]!.items[0].id
    s = reducer(s, { type: 'jobEvent', event: { id, status: 'done', outputPath: 'C:/x/a (1).webp' } })
    s = reducer(s, { type: 'jobEvent', event: { id, status: 'done', outputPath: 'C:/x/a (2).webp' } })
    const items = s.queues[IMAGES]!.items
    expect(items.filter((i) => !i.isResult)).toHaveLength(1)
    const results = items.filter((i) => i.isResult)
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.outputPath)).toEqual(['C:/x/a (1).webp', 'C:/x/a (2).webp'])
  })

  it('addSources appends pre-built input rows and selects them', () => {
    let s = reducer(start, { type: 'addItems', files: [img('a.png')] })
    const clone = {
      id: 'clone-1',
      file: img('a.png'),
      thumb: null,
      status: 'ready' as const,
      percent: 0
    }
    s = reducer(s, { type: 'addSources', items: [clone] })
    expect(s.queues[IMAGES]!.items.filter((i) => !i.isResult)).toHaveLength(2)
    expect(s.queues[IMAGES]!.selected).toEqual(['clone-1'])
  })
})

describe('navigation', () => {
  it('opens directly on the first operation, with no chooser in between', () => {
    expect(initialState.category).toBe('images')
    expect(initialState.operation).toBe('convert')
  })

  it('switching file type lands on that type\'s default operation, ready for files', () => {
    // Operation ids are per-category, so carrying one across would be meaningless.
    let s = open(initialState, 'upscale')
    s = reducer(s, { type: 'setCategory', category: 'pdf' })
    expect(s.category).toBe('pdf')
    expect(s.operation).toBe('extract-text')
    s = reducer(s, {
      type: 'addItems',
      files: [{ path: 'C:/x/a.pdf', name: 'a.pdf', ext: '.pdf', kind: 'pdf', size: 10 }]
    })
    expect(s.queues[PDF]!.items).toHaveLength(1)
  })

  it('keeps options per operation while the queue is shared', () => {
    // Set a Convert-only option, switch away and back: the option is remembered,
    // and separate from Compress's options.
    let s = reducer(start, { type: 'addItems', files: [img('a.png')] })
    s = reducer(s, { type: 'setOption', key: 'format', value: '.avif' })
    s = open(s, 'compress')
    expect(s.options[workspaceKey('images', 'compress')].quality).toBe(80) // its own default
    s = open(s, 'convert')
    expect(s.options[workspaceKey('images', 'convert')].format).toBe('.avif') // remembered
  })

  it('seeds a new operation with its tool defaults', () => {
    const s = open(initialState, 'compress')
    expect(s.options[workspaceKey('images', 'compress')].quality).toBe(80)
  })

  it('carries the PDF verb into the options, since one tool serves several ops', () => {
    // "Burst" and "Merge" are both the pdf tool; the op key is what separates them.
    expect(defaultOptionsFor('pdf', 'split-pages').op).toBe('split-pages')
    expect(defaultOptionsFor('pdf', 'merge').op).toBe('merge')
    // Compress under PDF is the compress tool, so it carries no verb.
    expect(defaultOptionsFor('pdf', 'compress').op).toBeUndefined()
  })
})
