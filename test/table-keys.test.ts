import { describe, expect, it } from 'vitest'
import { tableKey } from '../src/renderer/src/components/queue/tableKeys'

const k = (
  key: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods
})

describe('tableKey', () => {
  it('maps the spec 4.1 keys', () => {
    expect(tableKey(k('ArrowUp'))).toBe('up')
    expect(tableKey(k('ArrowDown'))).toBe('down')
    expect(tableKey(k('ArrowUp', { shiftKey: true }))).toBe('extendUp')
    expect(tableKey(k('ArrowDown', { shiftKey: true }))).toBe('extendDown')
    expect(tableKey(k(' '))).toBe('toggle')
    expect(tableKey(k('a', { ctrlKey: true }))).toBe('selectAll')
    expect(tableKey(k('A', { metaKey: true }))).toBe('selectAll')
    expect(tableKey(k('Delete'))).toBe('remove')
    expect(tableKey(k('Enter'))).toBe('open')
    expect(tableKey(k('ContextMenu'))).toBe('menu')
    expect(tableKey(k('F10', { shiftKey: true }))).toBe('menu')
  })
  it('ignores everything else, including Ctrl+Enter (that is Run)', () => {
    expect(tableKey(k('Enter', { ctrlKey: true }))).toBeNull()
    expect(tableKey(k('a'))).toBeNull()
    expect(tableKey(k('ArrowUp', { altKey: true }))).toBeNull()
  })
})
