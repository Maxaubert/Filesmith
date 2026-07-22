import { describe, expect, it } from 'vitest'
import { ignoredDimension, resizedSize } from '../src/shared/resize'

// Expected values are not hand-derived: each was produced by running the real
// `magick -resize <spec>` against a 4284x5712 source and reading back %wx%h.
const W = 4284
const H = 5712

describe('resizedSize matches ImageMagick', () => {
  it('fits inside the box, so the non-limiting field is ignored', () => {
    expect(resizedSize(W, H, 5000, 400, 'contain')).toEqual({ w: 300, h: 400 })
    // The bug the user hit: doubling the width changes nothing.
    expect(resizedSize(W, H, 2500, 400, 'contain')).toEqual({ w: 300, h: 400 })
  })

  it('honours both numbers when stretching', () => {
    expect(resizedSize(W, H, 5000, 400, 'stretch')).toEqual({ w: 5000, h: 400 })
  })

  it('scales by whichever field is filled in', () => {
    expect(resizedSize(W, H, 800, null, 'contain')).toEqual({ w: 800, h: 1067 })
    expect(resizedSize(W, H, null, 900, 'contain')).toEqual({ w: 675, h: 900 })
  })

  it('picks the smaller scale when both are given', () => {
    expect(resizedSize(W, H, 1000, 1000, 'contain')).toEqual({ w: 750, h: 1000 })
  })

  it('returns null when there is nothing to do', () => {
    expect(resizedSize(W, H, null, null, 'contain')).toBeNull()
    expect(resizedSize(W, H, 0, 0, 'contain')).toBeNull()
    expect(resizedSize(0, 0, 100, 100, 'contain')).toBeNull()
  })

  it('never rounds a dimension down to zero', () => {
    expect(resizedSize(4000, 10, 1, null, 'contain')).toEqual({ w: 1, h: 1 })
  })
})

describe('ignoredDimension', () => {
  it('names the field that has no effect', () => {
    expect(ignoredDimension(W, H, 5000, 400, 'contain')).toBe('width')
    expect(ignoredDimension(W, H, 100, 5000, 'contain')).toBe('height')
  })

  it('reports nothing when both fields matter', () => {
    expect(ignoredDimension(W, H, 5000, 400, 'stretch')).toBeNull()
    expect(ignoredDimension(W, H, 800, null, 'contain')).toBeNull()
  })
})
