import { describe, expect, it } from 'vitest'
import { buildFfmpegArgs, buildMagickArgs } from '../src/main/tools/convert'
import {
  categoryFormats,
  convertTargets,
  isSameFormat,
  magickExtraFor,
  toolForKind
} from '../src/shared/convert'
import { buildResizeArgs, buildResizeSpec } from '../src/main/tools/resize'
import { buildCompressArgs } from '../src/main/tools/compress'
import { fileKind } from '../src/shared/fileKind'

describe('fileKind', () => {
  it('classifies by extension', () => {
    expect(fileKind('.png')).toBe('image')
    expect(fileKind('mp4')).toBe('video')
    expect(fileKind('.MP3')).toBe('audio')
    expect(fileKind('.pdf')).toBe('pdf')
    expect(fileKind('.docx')).toBe('document')
    expect(fileKind('.xyz')).toBe('other')
  })
})

describe('convert (category-aware)', () => {
  it('offers only same-kind targets, excluding the source format', () => {
    const img = convertTargets('image', '.png').map((t) => t.label)
    expect(img).toContain('WebP')
    expect(img).not.toContain('PNG')
    const aud = convertTargets('audio', '.mp3').map((t) => t.label)
    expect(aud).toContain('FLAC')
    expect(aud).not.toContain('MP3')
    // audio targets never include image/video formats
    expect(aud).not.toContain('WebP')
    expect(aud).not.toContain('MP4')
  })

  it('drops alias-format duplicates (.tif -> no TIFF, .jpeg -> no JPG)', () => {
    expect(convertTargets('image', '.tif').map((t) => t.ext)).not.toContain('.tiff')
    expect(convertTargets('image', '.jpeg').map((t) => t.ext)).not.toContain('.jpg')
  })

  it('detects same-format no-ops (alias-aware)', () => {
    expect(isSameFormat('.jpg', '.jpeg')).toBe(true)
    expect(isSameFormat('.tif', '.tiff')).toBe(true)
    expect(isSameFormat('.png', '.webp')).toBe(false)
  })

  it('routes each kind to the right tool', () => {
    expect(toolForKind('image')).toBe('magick')
    expect(toolForKind('audio')).toBe('ffmpeg')
    expect(toolForKind('video')).toBe('ffmpeg')
    expect(toolForKind('other')).toBeNull()
  })

  it('builds magick args (with ICO multi-resize)', () => {
    expect(buildMagickArgs('a.png', 'b.webp')).toEqual(['a.png', 'b.webp'])
    expect(buildMagickArgs('a.png', 'b.ico', magickExtraFor('.ico'))).toEqual([
      'a.png',
      '-define',
      'icon:auto-resize=256,128,64,48,32,16',
      'b.ico'
    ])
  })

  it('builds ffmpeg args', () => {
    expect(buildFfmpegArgs('a.mp3', 'b.flac')).toEqual(['-y', '-i', 'a.mp3', 'b.flac'])
  })

  it('every format has a dotted extension', () => {
    for (const k of ['image', 'video', 'audio'] as const)
      for (const f of categoryFormats(k)) expect(f.ext.startsWith('.')).toBe(true)
  })
})

describe('resize', () => {
  it('builds a percent spec', () => {
    expect(buildResizeSpec({ mode: 'percent', percent: 50 })).toBe('50%')
  })
  it('builds an aspect-preserving dimensions spec', () => {
    expect(buildResizeSpec({ mode: 'dimensions', width: 800, height: 600 })).toBe('800x600')
  })
  it('appends ! for an exact-fit spec', () => {
    expect(buildResizeSpec({ mode: 'dimensions', width: 800, height: 600, exact: true })).toBe(
      '800x600!'
    )
  })
  it('builds magick -resize args', () => {
    expect(buildResizeArgs('in.png', 'out.png', '50%')).toEqual([
      'in.png',
      '-resize',
      '50%',
      'out.png'
    ])
  })
})

describe('compress', () => {
  it('builds caesiumclt args', () => {
    expect(buildCompressArgs('in.jpg', 'C:/tmp', 80)).toEqual([
      '-q',
      '80',
      '-o',
      'C:/tmp',
      'in.jpg'
    ])
  })
})
