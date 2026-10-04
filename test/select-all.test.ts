import { describe, expect, it } from 'vitest'
import {
  activeGroupFor,
  headerCheck,
  toggleAllIds
} from '../src/renderer/src/components/queue/selectAll'
import type { QueueItem } from '../src/renderer/src/state'

const row = (id: string, ext: string): QueueItem => ({
  id,
  file: {
    path: `C:/x/${id}${ext}`,
    name: id + ext,
    ext,
    kind: ext === '.mp4' ? 'video' : 'image',
    size: 1
  },
  thumb: null,
  status: 'ready',
  percent: 0
})
const items = [row('v1', '.mp4'), row('i1', '.png'), row('i2', '.png'), row('v2', '.mp4')]

describe('active group', () => {
  it('is the group of the selection', () => {
    expect(activeGroupFor(items, ['v2'])).toBe('video')
  })
  it('falls back to the first group in display order, not insertion order', () => {
    expect(activeGroupFor(items, [])).toBe('image')
  })
  it('is null for an empty queue', () => {
    expect(activeGroupFor([], [])).toBeNull()
  })
})

describe('header checkbox', () => {
  it('reads none, mixed and all for the active group only', () => {
    expect(headerCheck(items, [])).toBe('none')
    expect(headerCheck(items, ['i1'])).toBe('mixed')
    expect(headerCheck(items, ['i1', 'i2'])).toBe('all')
  })
  it('selects every row of the selected group and nothing else', () => {
    expect(toggleAllIds(items, ['v1'])).toEqual(['v1', 'v2'])
  })
  it('selects the first display group when nothing is selected', () => {
    expect(toggleAllIds(items, [])).toEqual(['i1', 'i2'])
  })
  it('clears when the whole group is already selected', () => {
    expect(toggleAllIds(items, ['i1', 'i2'])).toEqual([])
  })
})
