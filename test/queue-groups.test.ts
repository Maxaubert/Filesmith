import { describe, expect, it } from 'vitest'
import { groupItemsByGroup } from '../src/renderer/src/components/queueGroups'
import type { QueueItem } from '../src/renderer/src/state'
import type { FileKind } from '@shared/types'

const q = (id: string, kind: FileKind, ext = '.x'): QueueItem => ({
  id,
  file: { path: id, name: id, ext, kind, size: 1 },
  thumb: null,
  status: 'ready',
  percent: 0
})

describe('groupItemsByGroup', () => {
  it('returns no groups for a single-group queue, so it renders as today', () => {
    expect(groupItemsByGroup([q('a', 'image'), q('b', 'image')])).toBeNull()
  })

  it('returns no groups for an empty queue', () => {
    expect(groupItemsByGroup([])).toBeNull()
  })

  it('treats a pdf, a docx and a txt as ONE group, since they batch together', () => {
    const items = [q('a', 'pdf', '.pdf'), q('b', 'document', '.docx'), q('c', 'text', '.txt')]
    expect(groupItemsByGroup(items)).toBeNull()
  })

  it('groups a mixed queue in a stable order', () => {
    const g = groupItemsByGroup([q('v', 'video'), q('a', 'image'), q('s', 'audio')])!
    expect(g.map((x) => x.group)).toEqual(['image', 'video', 'audio'])
    expect(g[0].items.map((i) => i.id)).toEqual(['a'])
  })

  it('labels each group with its own plural', () => {
    const g = groupItemsByGroup([q('a', 'image'), q('v', 'video'), q('w', 'video')])!
    expect(g.map((x) => x.label)).toEqual(['Images', 'Video'])
    expect(g.map((x) => x.count)).toEqual(['1 image', '2 videos'])
  })

  it('separates archives from documents', () => {
    const g = groupItemsByGroup([q('d', 'document', '.docx'), q('c', 'archive', '.cbz')])!
    expect(g.map((x) => x.group)).toEqual(['doc', 'archive'])
    expect(g[1].count).toBe('1 archive')
  })

  it('puts an unknown group last rather than dropping it', () => {
    const g = groupItemsByGroup([q('o', 'other', '.xyz'), q('a', 'image')])!
    expect(g[0].group).toBe('image')
    expect(g[1].items.map((i) => i.id)).toEqual(['o'])
  })
})
