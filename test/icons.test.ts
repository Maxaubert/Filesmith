import { describe, expect, it } from 'vitest'
import { ICON_NAMES } from '@shared/icons'
import { ICON_SHAPES } from '../src/renderer/src/components/icons/shapes'
import { COMPLETED_TAB, SETTINGS_TAB, TABS, TOOL_CARDS } from '@shared/tabs'

describe('icon registry', () => {
  it('draws every declared icon', () => {
    for (const n of ICON_NAMES) expect(ICON_SHAPES[n]?.length, n).toBeGreaterThan(0)
  })
  it('contains the full mockup set', () => {
    const mockup = [
      'convert',
      'compress',
      'resize',
      'upscale',
      'removebg',
      'generate',
      'tools',
      'completed',
      'settings',
      'addfile',
      'folder',
      'play',
      'stop',
      'retry',
      'close',
      'check',
      'warning',
      'clock',
      'sync',
      'chev-r',
      'chev-d',
      'trash',
      'eye',
      'info',
      'arrow',
      'sidebar',
      'anvil'
    ]
    for (const n of mockup) expect(ICON_NAMES as readonly string[]).toContain(n)
  })
  it('stays inside the 16px grid', () => {
    for (const [name, prims] of Object.entries(ICON_SHAPES))
      for (const p of prims)
        if (p[0] !== 'path')
          for (const v of p.slice(1) as number[]) expect(v, name).toBeLessThanOrEqual(16)
  })
  it('draws the console glyphs', () => {
    for (const n of ['console', 'external', 'clear'] as const)
      expect(ICON_SHAPES[n].length).toBeGreaterThan(0)
  })
  it('every tab and tool card names a real icon', () => {
    for (const t of [...TABS, COMPLETED_TAB, SETTINGS_TAB, ...TOOL_CARDS])
      expect(ICON_NAMES as readonly string[]).toContain(t.icon)
  })
})
