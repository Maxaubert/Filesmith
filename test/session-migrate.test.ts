import { describe, expect, it } from 'vitest'
import { parseSession } from '../src/renderer/src/state'

const item = (p: string, kind = 'image'): unknown => ({
  id: p,
  file: { path: p, name: p, ext: '.png', kind, size: 1 },
  thumb: null,
  status: 'ready',
  percent: 0
})

// A v1 blob was keyed by file-type category. Files are a user's in-flight work,
// so an upgrade migrates them rather than discarding the session.
describe('v1 session migration', () => {
  it('moves each category queue to the tab its last operation names', () => {
    const r = parseSession({
      version: 1,
      lastOperation: { images: 'upscale', video: 'compress' },
      queues: {
        images: { items: [item('a.png')] },
        video: { items: [item('v.mp4', 'video')] }
      },
      options: { 'images:convert': { format: '.webp' } }
    })!
    expect(r.state.queues.upscale!.items.map((i) => i.file.path)).toEqual(['a.png'])
    expect(r.state.queues.compress!.items.map((i) => i.file.path)).toEqual(['v.mp4'])
  })

  it('merges two categories that land on the same tab, without duplicates', () => {
    const r = parseSession({
      version: 1,
      lastOperation: { images: 'convert', video: 'convert' },
      queues: {
        images: { items: [item('a.png')] },
        video: { items: [item('a.png'), item('v.mp4', 'video')] }
      }
    })!
    expect(r.state.queues.convert!.items.map((i) => i.file.path).sort()).toEqual(['a.png', 'v.mp4'])
  })

  it('lands a Tools verb in Convert rather than dropping its files', () => {
    const r = parseSession({
      version: 1,
      lastOperation: { pdf: 'merge' },
      queues: { pdf: { items: [item('doc.pdf', 'pdf')] } }
    })!
    expect(r.state.queues.convert!.items).toHaveLength(1)
  })

  it('falls back to Convert for a category with no remembered operation', () => {
    const r = parseSession({
      version: 1,
      queues: { documents: { items: [item('d.docx', 'document')] } }
    })!
    expect(r.state.queues.convert!.items).toHaveLength(1)
  })

  it('drops v1 options rather than guessing a group for them', () => {
    const r = parseSession({
      version: 1,
      queues: {},
      options: { 'images:convert': { format: '.webp' } }
    })!
    expect(Object.keys(r.state.options)).toHaveLength(0)
  })

  it('keeps generated results across the migration', () => {
    const r = parseSession({
      version: 1,
      queues: {},
      genResults: ['C:\\gen1.png', 'C:\\gen2.png']
    })!
    expect(r.genResults).toEqual(['C:\\gen1.png', 'C:\\gen2.png'])
  })

  it('drops a malformed item instead of rendering it', () => {
    const r = parseSession({
      version: 1,
      queues: { images: { items: [item('a.png'), { id: 'broken' }] } }
    })!
    expect(r.state.queues.convert!.items).toHaveLength(1)
  })
})

describe('v2 session', () => {
  it('restores tab-keyed queues and options', () => {
    const r = parseSession({
      version: 2,
      lastTool: 'pdf-merge',
      queues: { compress: { items: [item('a.png')] } },
      options: { 'compress:image': { quality: 70 } },
      genResults: []
    })!
    expect(r.state.queues.compress!.items).toHaveLength(1)
    expect(r.state.options['compress:image']).toEqual({ quality: 70 })
    expect(r.state.lastTool).toBe('pdf-merge')
  })

  it('always launches into the first verb, not the remembered one', () => {
    const r = parseSession({ version: 2, queues: { upscale: { items: [] } }, options: {} })!
    expect(r.state.tab).toBe('convert')
  })

  it('drops a queue whose workspace no longer exists', () => {
    const r = parseSession({
      version: 2,
      queues: { 'tools:gone-forever': { items: [item('a.png')] }, convert: { items: [] } },
      options: { 'tools:gone-forever:image': { x: 1 } }
    })!
    expect(r.state.queues['tools:gone-forever']).toBeUndefined()
    expect(Object.keys(r.state.options)).toHaveLength(0)
  })

  it('returns null for junk', () => {
    expect(parseSession(null)).toBeNull()
    expect(parseSession('nope')).toBeNull()
  })
})
