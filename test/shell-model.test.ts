import { describe, expect, it } from 'vitest'
import { crumbsFor } from '../src/renderer/src/components/shell/crumbs'
import { afterToggle, isCollapsed } from '../src/renderer/src/components/shell/sidebarState'
import {
  moveItem,
  normalizeOrder,
  sidebarVerbs
} from '../src/renderer/src/components/shell/railPrefs'
import {
  type FocusTarget,
  inConsole,
  isTextEntryTarget,
  shortcutFor
} from '../src/renderer/src/components/shell/shortcuts'
import type { KeyLike } from '../src/renderer/src/components/queue/tableKeys'
import { TABS, toolCardById, type TabId } from '@shared/tabs'

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
      { label: 'pdf tools', action: 'tools', ariaLabel: 'Back to Tools' },
      { label: 'merge' }
    ])
    expect(crumbsFor('tools', null, null)).toEqual([{ label: 'pdf tools' }])
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
  it('maps Ctrl+` by key code, on any layout', () => {
    expect(shortcutFor({ ...k('`', { ctrlKey: true }), code: 'Backquote' })).toBe('toggleConsole')
    expect(shortcutFor({ ...k('Dead', { ctrlKey: true }), code: 'Backquote' })).toBe(
      'toggleConsole'
    )
    expect(shortcutFor({ ...k('`'), code: 'Backquote' })).toBeNull()
  })
  it('knows when focus is inside the console', () => {
    expect(inConsole(null)).toBe(false)
    expect(
      inConsole({
        closest: (s: string) => (s === '.console' ? {} : null)
      } as unknown as FocusTarget)
    ).toBe(true)
  })
  it('knows when focus is in a text entry (view-size keys must not fire there)', () => {
    const el = (tagName: string, extra: Record<string, unknown> = {}): FocusTarget =>
      ({ tagName, isContentEditable: false, ...extra }) as unknown as FocusTarget
    expect(isTextEntryTarget(null)).toBe(false)
    expect(isTextEntryTarget(el('INPUT', { type: 'text' }))).toBe(true)
    expect(isTextEntryTarget(el('INPUT', { type: '' }))).toBe(true)
    expect(isTextEntryTarget(el('INPUT', { type: 'search' }))).toBe(true)
    expect(isTextEntryTarget(el('INPUT', { type: 'number' }))).toBe(true)
    expect(isTextEntryTarget(el('TEXTAREA'))).toBe(true)
    expect(isTextEntryTarget(el('DIV', { isContentEditable: true }))).toBe(true)
    expect(isTextEntryTarget(el('INPUT', { type: 'checkbox' }))).toBe(false)
    expect(isTextEntryTarget(el('INPUT', { type: 'range' }))).toBe(false)
    expect(isTextEntryTarget(el('BUTTON'))).toBe(false)
    expect(isTextEntryTarget(el('DIV'))).toBe(false)
  })
})
