import { describe, expect, it } from 'vitest'
import { initialWindowSize, MIN_WINDOW, windowBounds } from '../src/main/windowSize'

describe('initialWindowSize', () => {
  it('uses 1440x900 when the work area is larger', () => {
    expect(initialWindowSize({ width: 2560, height: 1400 })).toEqual({ width: 1440, height: 900 })
  })

  it('shrinks to the work area on a small display', () => {
    expect(initialWindowSize({ width: 1366, height: 728 })).toEqual({ width: 1366, height: 728 })
  })

  it('never starts larger than a tiny display', () => {
    expect(initialWindowSize({ width: 1024, height: 600 })).toEqual({ width: 1024, height: 600 })
  })
})

describe('windowBounds', () => {
  it('keeps the normal minimum on a normal display', () => {
    expect(windowBounds({ width: 1920, height: 1040 })).toEqual({
      width: 1440,
      height: 900,
      minWidth: MIN_WINDOW.width,
      minHeight: MIN_WINDOW.height
    })
  })

  it('lowers the minimum to the work area on a tiny display', () => {
    expect(windowBounds({ width: 1024, height: 600 })).toEqual({
      width: 1024,
      height: 600,
      minWidth: 1024,
      minHeight: 600
    })
  })
})
