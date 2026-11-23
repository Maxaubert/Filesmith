import { describe, expect, it } from 'vitest'
import {
  POPUP_MAX,
  popupPlacement,
  scrollTopFor
} from '../src/renderer/src/components/ui/selectNav'

// A 28px button inside a panel that shows y = 100 to 700.
const btn = (top: number): { top: number; bottom: number } => ({ top, bottom: top + 28 })

describe('popupPlacement', () => {
  it('opens down when the list fits below', () => {
    expect(popupPlacement(btn(150), 100, 700, 200)).toEqual({ up: false, maxHeight: POPUP_MAX })
  })

  it('opens up when it does not fit below and there is more room above', () => {
    expect(popupPlacement(btn(600), 100, 700, 200)).toEqual({ up: true, maxHeight: POPUP_MAX })
  })

  it('caps the height to the room above when flipped', () => {
    // 72px below, 150px above, a 252px list: up, cut to 150.
    expect(popupPlacement(btn(250), 100, 350, 252)).toEqual({ up: true, maxHeight: 150 })
  })

  it('takes the larger side with a reduced height when neither side fits', () => {
    // 160px below, 120px above, a 400px list: down, cut to 160.
    expect(popupPlacement(btn(220), 100, 408, 400)).toEqual({ up: false, maxHeight: 160 })
  })

  it('stays down when there is less room above', () => {
    expect(popupPlacement(btn(110), 100, 300, 400)).toEqual({ up: false, maxHeight: 162 })
  })

  it('never goes above 280px', () => {
    const p = popupPlacement(btn(100), 0, 2000, 1000)
    expect(p.maxHeight).toBe(280)
    expect(popupPlacement(btn(1900), 0, 2000, 1000).maxHeight).toBe(280)
  })

  it('never returns a negative height', () => {
    expect(popupPlacement(btn(690), 700, 710, 100).maxHeight).toBeGreaterThanOrEqual(0)
  })
})

describe('scrollTopFor', () => {
  it('leaves the list alone when the row is visible', () => {
    expect(scrollTopFor(56, 28, 0, 280)).toBe(0)
  })

  it('scrolls down just enough to show a row below the view', () => {
    expect(scrollTopFor(560, 28, 0, 280)).toBe(308)
  })

  it('scrolls up to a row above the view', () => {
    expect(scrollTopFor(28, 28, 300, 280)).toBe(28)
  })
})
