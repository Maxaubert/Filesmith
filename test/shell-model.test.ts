import { describe, expect, it } from 'vitest'
import { crumbsFor } from '../src/renderer/src/components/shell/crumbs'
import { afterToggle, isCollapsed } from '../src/renderer/src/components/shell/sidebarState'
import {
  moveItem,
  normalizeOrder,
  sidebarVerbs
} from '../src/renderer/src/components/shell/railPrefs'
import { statusSummary, verbGerund } from '../src/renderer/src/components/shell/statusModel'
import { shortcutFor } from '../src/renderer/src/components/shell/shortcuts'
import type { KeyLike } from '../src/renderer/src/components/queue/tableKeys'
import { TABS, toolCardById, type TabId } from '@shared/tabs'
import type { QueueItem } from '../src/renderer/src/state'

describe('breadcrumb', () => {
  it('shows the verb, then the active group as the current segment', () => {
    expect(crumbsFor('convert', null, 'image')).toEqual([
      { label: 'convert', action: 'clearSelection' },
      { label: 'images' }
    ])
    expect(crumbsFor('removebg', null, null)).toEqual([{ label: 'remove bg' }])
  })
  it('makes tools a Back to Tools button inside a card', () => {
    expect(crumbsFor('tools', toolCardById('pdf-merge')!, 'doc')).toEqual([
      { label: 'tools', action: 'tools', ariaLabel: 'Back to Tools' },
      { label: 'merge' }
    ])
    expect(crumbsFor('tools', null, null)).toEqual([{ label: 'tools' }])
  })
  it('has a single segment for generate, completed and settings', () => {
    for (const t of ['generate', 'completed', 'settings'] as TabId[])
      expect(crumbsFor(t, null, 'image')).toEqual([{ label: t }])
  })
})

describe('sidebar collapse', () => {
  it('follows the stored preference on a wide window', () => {
    expect(isCollapsed('expanded', false, null)).toBe(false)
    expect(isCollapsed('collapsed', false, null)).toBe(true)
  })
  it('auto-collapses when narrow without touching the preference', () => {
    expect(isCollapsed('expanded', true, null)).toBe(true)
    expect(afterToggle('expanded', true, null)).toEqual({ pref: 'expanded', override: false })
  })
  it('a wide toggle flips and persists the preference', () => {
    expect(afterToggle('expanded', false, null)).toEqual({ pref: 'collapsed', override: null })
    expect(afterToggle('collapsed', false, null)).toEqual({ pref: 'expanded', override: null })
  })
})

describe('rail preferences', () => {
  const all = TABS.map((t) => t.id)
  it('keeps a saved order, drops unknown ids and appends new verbs', () => {
    expect(normalizeOrder(['resize', 'bogus', 'convert'], all).slice(0, 2)).toEqual([
      'resize',
      'convert'
    ])
    expect(normalizeOrder(['resize'], all)).toHaveLength(all.length)
    expect(normalizeOrder('garbage', all)).toEqual(all)
  })
  it('moves an item', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })
  it('lists visible verbs without Tools, which has its own slot', () => {
    expect(sidebarVerbs(all, ['upscale'])).toEqual([
      'convert',
      'compress',
      'resize',
      'removebg',
      'generate'
    ])
  })
})

const row = (id: string, status: QueueItem['status'], percent = 0): QueueItem => ({
  id,
  file: { path: `C:/${id}.png`, name: `${id}.png`, ext: '.png', kind: 'image', size: 1 },
  thumb: null,
  status,
  percent,
  hasProgress: percent > 0
})

describe('status bar', () => {
  const items = [
    row('a', 'done'),
    row('b', 'done'),
    row('c', 'running', 62),
    row('d', 'queued'),
    row('e', 'queued'),
    row('f', 'failed')
  ]
  it('reports the batch in flight, done count and failures', () => {
    const s = statusSummary(items, ['a', 'b', 'c', 'd', 'e', 'f'], 'Convert')
    expect(s.running).toEqual({ label: 'Converting 3 of 6', pct: 60 })
    expect(s.done).toBe('2 of 6 done')
    expect(s.failed).toBe(1)
  })
  it('drops the running item once the batch settles or without a batch', () => {
    const settled = items.map((i) =>
      i.status === 'queued' || i.status === 'running' ? { ...i, status: 'done' as const } : i
    )
    expect(statusSummary(settled, ['a', 'b', 'c', 'd', 'e', 'f'], 'Convert').running).toBeNull()
    expect(statusSummary(items, null, 'Convert').running).toBeNull()
  })
  it('renders nothing for an empty queue', () => {
    expect(statusSummary([], null, 'Convert')).toEqual({
      running: null,
      message: null,
      done: null,
      failed: 0
    })
  })
  it('names each verb', () => {
    expect(verbGerund('Remove BG')).toBe('Removing backgrounds')
    expect(verbGerund('Merge')).toBe('Processing')
  })
})

describe('global shortcuts', () => {
  const k = (key: string, o: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...o
  })
  it('maps Ctrl+B, Ctrl+O and Ctrl+Enter', () => {
    expect(shortcutFor(k('b', { ctrlKey: true }))).toBe('toggleSidebar')
    expect(shortcutFor(k('O', { ctrlKey: true }))).toBe('addFiles')
    expect(shortcutFor(k('Enter', { ctrlKey: true }))).toBe('run')
  })
  it('ignores plain keys and Alt combinations', () => {
    expect(shortcutFor(k('b'))).toBeNull()
    expect(shortcutFor(k('b', { ctrlKey: true, altKey: true }))).toBeNull()
  })
})
