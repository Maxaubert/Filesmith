import { describe, expect, it } from 'vitest'
import { buildUpscaleArgs, needsPreConvert, upscaleProgress } from '../src/main/tools/upscale'
import {
  estimatedPngBytes,
  formatBytes,
  HUGE_OUTPUT_BYTES,
  UPSCALE_FACTORS,
  upscaledSize
} from '../src/shared/compress'

describe('buildUpscaleArgs', () => {
  it('passes the model, factor and png output format', () => {
    const args = buildUpscaleArgs('in.png', 'out.png', { model: 'realesrgan-x4plus', factor: 4 })
    expect(args).toEqual([
      '-i',
      'in.png',
      '-o',
      'out.png',
      '-n',
      'realesrgan-x4plus',
      '-s',
      '4',
      '-f',
      'png'
    ])
  })

  it('passes the model name through verbatim (any ncnn model, not a fixed two)', () => {
    // The binary runs whatever .param/.bin pair it is pointed at, so the arg
    // builder must not translate a closed set of ids.
    for (const n of ['realesrgan-x4plus-anime', 'realesrgan-animevideov3', '4x-Whatever-2026'])
      expect(buildUpscaleArgs('a.png', 'b.png', { model: n, factor: 2 })).toContain(n)
  })

  it('supports every factor the UI offers', () => {
    for (const f of UPSCALE_FACTORS) {
      const args = buildUpscaleArgs('a.png', 'b.png', { model: 'realesrgan-x4plus', factor: f })
      expect(args[args.indexOf('-s') + 1]).toBe(String(f))
    }
  })

  it('falls back to 4x for a factor the binary cannot do', () => {
    const args = buildUpscaleArgs('a.png', 'b.png', { model: 'realesrgan-x4plus', factor: 7 })
    expect(args[args.indexOf('-s') + 1]).toBe('4')
  })
})

describe('needsPreConvert', () => {
  it('passes through the formats the binary reads', () => {
    for (const e of ['.png', '.jpg', '.webp', '.PNG']) expect(needsPreConvert(e)).toBe(false)
  })

  it('pre-converts everything else, so any image format works', () => {
    for (const e of ['.heic', '.jxl', '.svg', '.tiff', '.bmp', '.ico', '.gif'])
      expect(needsPreConvert(e)).toBe(true)
  })
})

describe('upscaleProgress', () => {
  it('reads the last percentage in a chunk', () => {
    const seen: number[] = []
    const on = upscaleProgress((p) => seen.push(p))
    on('12.50%\n25.00%\n')
    expect(seen).toEqual([25])
  })

  it('never reports 100 (the job completes only when the file lands)', () => {
    const seen: number[] = []
    upscaleProgress((p) => seen.push(p))('100.00%')
    expect(seen).toEqual([99])
  })

  it('ignores output with no percentage', () => {
    const seen: number[] = []
    upscaleProgress((p) => seen.push(p))('loading model...')
    expect(seen).toEqual([])
  })
})

describe('upscaledSize', () => {
  it('multiplies both dimensions', () => {
    expect(upscaledSize(640, 420, 4)).toEqual({ w: 2560, h: 1680 })
    expect(upscaledSize(500, 500, 3)).toEqual({ w: 1500, h: 1500 })
  })
})

describe('output size estimate', () => {
  it('tracks the measured 192 MP -> 195 MB result within 25%', () => {
    const { w, h } = upscaledSize(4000, 3000, 4)
    const est = estimatedPngBytes(w, h)
    const measured = 195 * 1024 ** 2
    expect(Math.abs(est - measured) / measured).toBeLessThan(0.25)
  })

  it('does not warn for an ordinary 12 MP photo at 4x', () => {
    const { w, h } = upscaledSize(4000, 3000, 4)
    expect(estimatedPngBytes(w, h)).toBeLessThan(HUGE_OUTPUT_BYTES)
  })

  it('warns for an absurd upscale', () => {
    const { w, h } = upscaledSize(20000, 20000, 4)
    expect(estimatedPngBytes(w, h)).toBeGreaterThan(HUGE_OUTPUT_BYTES)
  })
})

describe('formatBytes', () => {
  it('scales the unit to the size', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB')
    expect(formatBytes(8 * 1024 ** 3)).toBe('8.0 GB')
    expect(formatBytes(40 * 1024 ** 4)).toBe('40 TB')
  })
})
