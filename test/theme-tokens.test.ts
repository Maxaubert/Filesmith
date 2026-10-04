// test/theme-tokens.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const css = readFileSync(join(__dirname, '../src/renderer/src/theme/tokens.css'), 'utf-8')

const EXPECTED: Record<string, string> = {
  'bg-0': '#0a0a0a',
  'bg-1': '#0f0f0f',
  hover: '#1a1a1a',
  selected: '#202020',
  field: '#141414',
  track: '#2a2a2a',
  line: '#262626',
  'line-strong': '#3a3a3a',
  fg1: '#ededed',
  fg2: '#b4b4b4',
  fg3: '#8c8c8c',
  'fg-disabled': '#5c5c5c',
  'inv-bg': '#2a2a2a',
  'inv-fg': '#ededed',
  'inv-hover': '#3a3a3a',
  'inv-active': '#202020',
  focus: '#ededed'
}

function expand(hex: string): string {
  const h = hex.slice(1).toLowerCase()
  return h.length === 3
    ? h
        .split('')
        .map((c) => c + c)
        .join('')
    : h.slice(0, 6)
}

describe('design tokens', () => {
  it('defines every spec token with its exact value', () => {
    for (const [name, value] of Object.entries(EXPECTED)) {
      const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`))
      expect(m?.[1]?.toLowerCase(), name).toBe(value)
    }
  })

  it('is strictly monochrome: every colour token has r = g = b', () => {
    const all = [...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\b/g)]
    expect(all.length).toBeGreaterThanOrEqual(Object.keys(EXPECTED).length)
    for (const [, name, hex] of all) {
      const h = expand(hex)
      expect(h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6), name).toBe(true)
    }
  })
})
