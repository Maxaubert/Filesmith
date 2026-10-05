import { describe, expect, it } from 'vitest'
import { cardLine, kindIcon } from '../src/renderer/src/components/queue/cardModel'
import type { RowView } from '../src/renderer/src/components/queue/rowModel'

const base: RowView = {
  kind: 'PNG',
  size: '1.8 MB',
  result: null,
  status: { kind: 'ready', text: '' },
  action: { kind: 'remove', icon: 'close', label: 'Remove', ghost: true }
}
const done: RowView = {
  ...base,
  result: { text: '486 KB', pct: '-77%', estimate: false, grew: false },
  status: { kind: 'done', text: 'Done' }
}
const running: RowView = {
  ...base,
  result: { text: '~410 KB', pct: '-77%', estimate: true, grew: false },
  status: { kind: 'running', text: '', pct: '62%', eta: '(4s)' }
}
const failed: RowView = {
  ...base,
  status: {
    kind: 'failed',
    text: 'Unsupported compression',
    title: 'Unsupported compression in TIFF'
  }
}

describe('cardLine', () => {
  it('done: result, then %, then the source size as the cards grow', () => {
    expect(cardLine(done, 'medium')).toEqual({ kind: 'done', icon: 'check', strong: '486 KB' })
    expect(cardLine(done, 'large')).toEqual({
      kind: 'done',
      icon: 'check',
      strong: '486 KB',
      pct: '-77%'
    })
    expect(cardLine(done, 'xl')).toEqual({
      kind: 'done',
      icon: 'check',
      strong: '486 KB',
      pct: '-77%',
      extra: '1.8 MB'
    })
    expect(cardLine({ ...done, result: null }, 'medium').strong).toBe('Done')
  })
  it('running: 62%(4s), plus the estimate from Large up', () => {
    expect(cardLine(running, 'medium')).toEqual({
      kind: 'running',
      icon: 'sync',
      strong: '62%',
      eta: '(4s)'
    })
    expect(cardLine(running, 'large').extra).toBe('~410 KB')
  })
  it('queued and canceled add the source size from Large up', () => {
    const q: RowView = { ...base, status: { kind: 'queued', text: 'Queued' } }
    expect(cardLine(q, 'medium')).toEqual({ kind: 'queued', icon: 'clock', text: 'Queued' })
    expect(cardLine(q, 'large').extra).toBe('1.8 MB')
    const c: RowView = { ...base, status: { kind: 'canceled', text: 'Canceled' } }
    expect(cardLine(c, 'medium')).toEqual({ kind: 'canceled', icon: 'close', text: 'Canceled' })
    expect(cardLine(c, 'xl').extra).toBe('1.8 MB')
  })
  it('failed: "Failed" on Medium, the short error from Large up, full error as title', () => {
    expect(cardLine(failed, 'medium')).toEqual({
      kind: 'failed',
      icon: 'warning',
      text: 'Failed',
      title: 'Unsupported compression in TIFF'
    })
    expect(cardLine(failed, 'large').text).toBe('Unsupported compression')
  })
  it('ready: just the source size', () => {
    expect(cardLine(base, 'medium')).toEqual({ kind: 'ready', icon: null, text: '1.8 MB' })
  })
})

describe('kindIcon', () => {
  it('maps each file kind to a glyph', () => {
    expect(kindIcon('image')).toBe('image')
    expect(kindIcon('video')).toBe('video')
    expect(kindIcon('audio')).toBe('audio')
    expect(kindIcon('pdf')).toBe('pdf')
    expect(kindIcon('document')).toBe('doc')
    expect(kindIcon('text')).toBe('text')
    expect(kindIcon('archive')).toBe('archive')
    expect(kindIcon('other')).toBe('doc')
  })
})
