// test/size-estimate.test.ts
import { describe, expect, it } from 'vitest'
import { estimateBatch, estimateOutputBytes, medianRatio, ratioFor } from '@shared/sizeEstimate'
import type { FileInfo } from '@shared/types'

const png: FileInfo = {
  path: 'C:/a.png',
  name: 'a.png',
  ext: '.png',
  kind: 'image',
  size: 1_000_000
}
const mp4: FileInfo = {
  path: 'C:/a.mp4',
  name: 'a.mp4',
  ext: '.mp4',
  kind: 'video',
  size: 10_000_000
}
const wav: FileInfo = {
  path: 'C:/a.wav',
  name: 'a.wav',
  ext: '.wav',
  kind: 'audio',
  size: 5_000_000
}
const pdf: FileInfo = { path: 'C:/a.pdf', name: 'a.pdf', ext: '.pdf', kind: 'pdf', size: 2_000_000 }

describe('medianRatio', () => {
  it('takes the median output/source ratio', () => {
    expect(
      medianRatio([
        { source: 10, output: 1 },
        { source: 10, output: 3 },
        { source: 10, output: 9 }
      ])
    ).toBeCloseTo(0.3)
    expect(
      medianRatio([
        { source: 10, output: 2 },
        { source: 10, output: 4 }
      ])
    ).toBeCloseTo(0.3)
  })
  it('ignores zero-byte sources and returns null with nothing usable', () => {
    expect(medianRatio([])).toBeNull()
    expect(medianRatio([{ source: 0, output: 5 }])).toBeNull()
  })
})

describe('ratio table', () => {
  it('knows image convert targets by quality preset', () => {
    expect(ratioFor('convert', png, { format: '.webp', quality: 'balanced' })).toBeCloseTo(0.22)
    expect(ratioFor('convert', png, { format: '.avif', quality: 'smaller' })).toBeCloseTo(0.1)
  })
  it('has no ratio for lossless or odd targets', () => {
    expect(ratioFor('convert', png, { format: '.bmp' })).toBeNull()
    expect(ratioFor('convert', mp4, { format: '.mkv' })).toBeNull()
  })
  it('scales video compress by codec, quality and scale', () => {
    const full = ratioFor('compress', mp4, { videoCodec: 'h264', quality: 80, scale: 100 })!
    const half = ratioFor('compress', mp4, { videoCodec: 'h264', quality: 80, scale: 50 })!
    expect(full).toBeCloseTo(0.5)
    expect(half).toBeCloseTo(0.125)
  })
  it('has no ratio for audio without a known source bitrate', () => {
    expect(ratioFor('compress', wav, { audioCodec: 'mp3', audioBitrate: 192 })).toBeNull()
  })
  it('maps PDF levels', () => {
    expect(ratioFor('compress', pdf, { pdfLevel: 'smallest' })).toBeCloseTo(0.3)
  })
  it('never estimates tools whose output is not comparable', () => {
    for (const t of ['pdf', 'archive', 'generate', 'removebg'] as const)
      expect(ratioFor(t, png, {})).toBeNull()
  })
})

describe('estimateOutputBytes', () => {
  it('prefers finished rows of the same batch over the table', () => {
    const v = estimateOutputBytes(
      png,
      'convert',
      { format: '.webp', quality: 'balanced' },
      {
        samples: [{ source: 100, output: 50 }]
      }
    )
    expect(v).toBe(500_000)
  })
  it('uses pixels for resize and upscale', () => {
    expect(
      estimateOutputBytes(png, 'resize', { mode: 'percent', percent: 50 }, { pixelRatio: 0.25 })
    ).toBe(250_000)
    expect(estimateOutputBytes(png, 'upscale', { upscaleFactor: 2 }, { outPixels: 1000 })).toBe(
      1200
    )
  })
  it('returns null, never 0 or NaN, when there is nothing to go on', () => {
    expect(estimateOutputBytes(png, 'resize', {}, {})).toBeNull()
    expect(estimateOutputBytes({ ...png, size: 0 }, 'convert', { format: '.webp' })).toBeNull()
    expect(estimateOutputBytes(wav, 'compress', { audioCodec: 'mp3' })).toBeNull()
  })
})

describe('estimateBatch', () => {
  it('sums only rows that have an estimate and counts them', () => {
    expect(
      estimateBatch([
        { size: 100, estimate: 20 },
        { size: 50, estimate: null },
        { size: 300, estimate: 60 }
      ])
    ).toEqual({ from: 400, to: 80, files: 2 })
  })
  it('is null when no row can be estimated', () => {
    expect(estimateBatch([{ size: 100, estimate: null }])).toBeNull()
    expect(estimateBatch([])).toBeNull()
  })
})
