import { describe, expect, it } from 'vitest'
import { initialWindowSize, MIN_WINDOW } from '../src/main/windowSize'

describe('initialWindowSize', () => {
  it('uses 1440x900 when the work area is larger', () => {
    expect(initialWindowSize({ width: 2560, height: 1400 })).toEqual({ width: 1440, height: 900 })
  })

  it('shrinks to the work area on a small display', () => {
    expect(initialWindowSize({ width: 1366, height: 728 })).toEqual({ width: 1366, height: 728 })
  })

  it('never goes below the minimum, even on a tiny display', () => {
    expect(initialWindowSize({ width: 1024, height: 600 })).toEqual(MIN_WINDOW)
  })
})
