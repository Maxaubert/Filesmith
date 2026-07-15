import { describe, expect, it } from 'vitest'
import {
  buildConvertArgs,
  convertTargets,
  findTarget,
  IMAGE_TARGETS
} from '../src/main/tools/convert'
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

describe('convert', () => {
  it('offers every target except the source format', () => {
    const labels = convertTargets('.png').map((t) => t.label)
    expect(labels).toContain('WebP')
    expect(labels).not.toContain('PNG')
  })

  it('drops alias-format duplicates (.tif -> no TIFF, .jpeg -> no JPG)', () => {
    expect(convertTargets('.tif').map((t) => t.ext)).not.toContain('.tiff')
    expect(convertTargets('.jpeg').map((t) => t.ext)).not.toContain('.jpg')
  })

  it('builds magick args with extra flags for ICO', () => {
    const ico = findTarget('.ico')
    expect(ico?.extra).toContain('icon:auto-resize=256,128,64,48,32,16')
    expect(buildConvertArgs('in.png', 'out.ico', ico?.extra)).toEqual([
      'in.png',
      '-define',
      'icon:auto-resize=256,128,64,48,32,16',
      'out.ico'
    ])
  })

  it('builds plain magick args otherwise', () => {
    expect(buildConvertArgs('a.png', 'b.webp')).toEqual(['a.png', 'b.webp'])
  })

  it('every target has a dotted extension', () => {
    for (const t of IMAGE_TARGETS) expect(t.ext.startsWith('.')).toBe(true)
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
