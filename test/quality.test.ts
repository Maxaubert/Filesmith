import { describe, expect, it } from 'vitest'
import { qualityNum } from '../src/main/tools/convert'

describe('qualityNum', () => {
  it('maps presets to magick -quality values', () => {
    expect(qualityNum('smaller')).toBe(60)
    expect(qualityNum('balanced')).toBe(82)
    expect(qualityNum('best')).toBe(95)
  })
  it('clamps numeric quality to 1..100', () => {
    expect(qualityNum(50)).toBe(50)
    expect(qualityNum(0)).toBeNull() // treated as unset
    expect(qualityNum(150)).toBe(100)
  })
  it('returns null for unknown values (leave the default)', () => {
    expect(qualityNum(undefined)).toBeNull()
    expect(qualityNum('whatever')).toBeNull()
  })
})
