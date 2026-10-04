// test/ui-nav.test.ts
import { describe, expect, it } from 'vitest'
import { rovingIndex } from '../src/renderer/src/components/ui/roving'
import { nextEnabled } from '../src/renderer/src/components/ui/selectNav'

describe('rovingIndex', () => {
  it('wraps left and right on the x axis', () => {
    expect(rovingIndex('ArrowRight', 2, 3)).toBe(0)
    expect(rovingIndex('ArrowLeft', 0, 3)).toBe(2)
  })
  it('uses up and down on the y axis only', () => {
    expect(rovingIndex('ArrowDown', 0, 3, 'y')).toBe(1)
    expect(rovingIndex('ArrowRight', 0, 3, 'y')).toBeNull()
  })
  it('jumps with Home and End', () => {
    expect(rovingIndex('Home', 2, 3)).toBe(0)
    expect(rovingIndex('End', 0, 3)).toBe(2)
  })
  it('does nothing for an empty set or another key', () => {
    expect(rovingIndex('ArrowRight', 0, 0)).toBeNull()
    expect(rovingIndex('a', 0, 3)).toBeNull()
  })
})

describe('nextEnabled (select popup keyboard)', () => {
  const opts = [
    { label: 'webp' },
    { label: 'png', disabled: true },
    { label: 'avif' },
    { label: 'jpg' }
  ]
  it('skips disabled options with the arrows and stops at the ends', () => {
    expect(nextEnabled(opts, 0, 'ArrowDown')).toBe(2)
    expect(nextEnabled(opts, 2, 'ArrowUp')).toBe(0)
    expect(nextEnabled(opts, 3, 'ArrowDown')).toBe(3)
  })
  it('Home and End land on enabled options', () => {
    expect(nextEnabled([{ label: 'x', disabled: true }, ...opts], 3, 'Home')).toBe(1)
    expect(nextEnabled(opts, 0, 'End')).toBe(3)
  })
  it('type-ahead finds the next enabled match after the current one', () => {
    expect(nextEnabled(opts, 0, 'a')).toBe(2)
    expect(nextEnabled(opts, 0, 'p')).toBeNull() // png is disabled
    expect(nextEnabled(opts, 2, 'W')).toBe(0)
  })
})
