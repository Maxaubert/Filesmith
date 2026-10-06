// test/menu-toggle.test.ts
import { describe, expect, it } from 'vitest'
import { toggleMenu } from '../src/renderer/src/components/menuToggle'

describe('toggleMenu', () => {
  type M = { trigger?: string; x: number }
  const a: M = { trigger: 'folder', x: 1 }
  const b: M = { trigger: 'other', x: 2 }
  it('opens when nothing is open', () => {
    expect(toggleMenu(null, a)).toBe(a)
  })
  it('closes when the open menu came from the same trigger', () => {
    expect(toggleMenu(a, { ...a })).toBeNull()
  })
  it('replaces a menu from another trigger', () => {
    expect(toggleMenu(a, b)).toBe(b)
  })
  it('always opens a menu without a trigger (right-click menus)', () => {
    const r: M = { x: 3 }
    expect(toggleMenu(r, r)).toBe(r)
    expect(toggleMenu(a, r)).toBe(r)
  })
})
