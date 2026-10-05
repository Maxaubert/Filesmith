import { describe, expect, it } from 'vitest'
import {
  bestThumb,
  needsThumb,
  thumbKey,
  thumbPxFor,
  THUMB_BUCKETS
} from '../src/renderer/src/components/queue/thumbSize'
import { VIEW_SIZES } from '../src/renderer/src/components/queue/viewSize'
import { magickGeometry, osTooSmall, scale } from '../src/main/thumbnail'

const per = (dpr: number): number[] => VIEW_SIZES.map((s) => thumbPxFor(s.id, dpr))

describe('thumbnail bucket per size and screen', () => {
  // details, details-l, tiles, medium, large, xl
  it('DPR 1: 128 for the lists and tiles, then 256, 256, 512', () => {
    expect(per(1)).toEqual([128, 128, 128, 256, 256, 512])
  })
  it('DPR 1.5', () => {
    expect(per(1.5)).toEqual([128, 128, 128, 256, 512, 512])
  })
  it('DPR 2.25 (a 4K screen at 225%): Extra large icons get 768', () => {
    expect(per(2.25)).toEqual([128, 128, 128, 512, 512, 768])
  })
  it('caps at the largest bucket and treats a bad ratio as 1', () => {
    expect(thumbPxFor('xl', 8)).toBe(1024)
    expect(thumbPxFor('xl', 0)).toBe(512)
    expect(thumbPxFor('xl', Number.NaN)).toBe(512)
    expect(THUMB_BUCKETS).toEqual([128, 256, 512, 768, 1024])
  })
})

describe('big thumbnail cache', () => {
  const p = 'C:\\x\\a.png'
  it('keys by path and bucket', () => {
    expect(thumbKey(p, 512)).toBe('C:\\x\\a.png@512')
  })
  it('shows the wanted bucket, else a bigger one, else the best smaller one', () => {
    expect(bestThumb({}, p, 512)).toBeUndefined()
    expect(bestThumb({ [thumbKey(p, 256)]: 's' }, p, 512)).toBe('s')
    const both = { [thumbKey(p, 256)]: 's', [thumbKey(p, 768)]: 'l' }
    expect(bestThumb(both, p, 768)).toBe('l')
    expect(bestThumb(both, p, 512)).toBe('l')
    expect(bestThumb(both, p, 256)).toBe('s')
    expect(bestThumb({ [thumbKey(p, 512)]: null }, p, 512)).toBeUndefined()
  })
  it('asks only when nothing at or above the bucket is cached', () => {
    expect(needsThumb({}, p, 128)).toBe(false)
    expect(needsThumb({}, p, 512)).toBe(true)
    expect(needsThumb({ [thumbKey(p, 256)]: 's' }, p, 512)).toBe(true)
    expect(needsThumb({ [thumbKey(p, 768)]: 'l' }, p, 512)).toBe(false)
    expect(needsThumb({ [thumbKey('other', 768)]: 'l' }, p, 512)).toBe(true)
  })
})

describe('OS thumbnail too small -> tool fallback', () => {
  const d = (width: number, height: number) => ({ width, height })
  it('falls back when the shell caps a big request at 256', () => {
    expect(osTooSmall(d(256, 171), 768, 'image')).toBe(true)
    expect(osTooSmall(d(256, 144), 512, 'video')).toBe(true)
    expect(osTooSmall(d(256, 256), 512, 'audio')).toBe(true)
  })
  it('keeps a result that meets the request, give or take rounding', () => {
    expect(osTooSmall(d(768, 512), 768, 'image')).toBe(false)
    expect(osTooSmall(d(767, 511), 768, 'image')).toBe(false)
  })
  it('cover measures the short side, so a fitted 16:9 frame is too small', () => {
    expect(osTooSmall(d(768, 432), 768, 'video', 'cover')).toBe(true)
    expect(osTooSmall(d(1365, 768), 768, 'video', 'cover')).toBe(false)
  })
  it('never expects more than the source has', () => {
    expect(osTooSmall(d(300, 200), 768, 'image', 'contain', d(300, 200))).toBe(false)
    expect(osTooSmall(d(300, 200), 768, 'image', 'cover', d(300, 200))).toBe(false)
    expect(osTooSmall(d(256, 171), 768, 'image', 'contain', d(3000, 2000))).toBe(true)
  })
  it('leaves the 128px request and tool-less kinds alone', () => {
    expect(osTooSmall(d(96, 64), 128, 'image')).toBe(false)
    expect(osTooSmall(d(256, 256), 768, 'pdf')).toBe(false)
    expect(osTooSmall(d(256, 256), 768, 'other')).toBe(false)
  })
  it('the tool sizes fit or fill without upscaling', () => {
    expect(scale(768)).toBe(
      "scale='min(768,iw)':'min(768,ih)':force_original_aspect_ratio=decrease"
    )
    expect(scale(768, 'cover')).toBe(
      "scale='min(768,iw)':'min(768,ih)':force_original_aspect_ratio=increase"
    )
    expect(magickGeometry(128)).toBe('128x128>')
    expect(magickGeometry(768, 'cover')).toBe('768x768^>')
  })
})
