import { describe, expect, it } from 'vitest'
import { buildFfmpegArgs, buildMagickArgs } from '../src/main/tools/convert'
import {
  categoryFormats,
  convertTargets,
  isSameFormat,
  magickExtraFor,
  toolForKind
} from '../src/shared/convert'
import { buildResizeArgs, buildResizeSpec, isValidResizeSpec } from '../src/main/tools/resize'
import {
  buildAudioCompressArgs,
  buildCompressArgs,
  buildMagickCompressArgs,
  buildVideoCompressArgs,
  crfForQuality,
  kbpsForQuality,
  CAESIUM_EXTS
} from '../src/main/tools/compress'
import { canCompress } from '../src/shared/convert'
import { fileKind } from '../src/shared/fileKind'

describe('fileKind', () => {
  it('classifies by extension', () => {
    expect(fileKind('.png')).toBe('image')
    expect(fileKind('mp4')).toBe('video')
    expect(fileKind('.MP3')).toBe('audio')
    expect(fileKind('.pdf')).toBe('pdf')
    expect(fileKind('.docx')).toBe('document')
    expect(fileKind('.xlsx')).toBe('document')
    expect(fileKind('.txt')).toBe('text')
    expect(fileKind('.md')).toBe('text')
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
    expect(toolForKind('document')).toBe('soffice')
    expect(toolForKind('pdf')).toBe('soffice')
    expect(toolForKind('text')).toBe('soffice')
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

  it('flattens transparency onto white for no-alpha targets (jpg/bmp)', () => {
    expect(magickExtraFor('.jpg')).toEqual([
      '-background',
      'white',
      '-alpha',
      'remove',
      '-alpha',
      'off'
    ])
    expect(magickExtraFor('.bmp')).toContain('-alpha')
    // alpha-capable targets get no flatten
    expect(magickExtraFor('.png')).toEqual([])
    expect(magickExtraFor('.webp')).toEqual([])
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
  it('coalesces + re-optimizes animated GIFs', () => {
    expect(buildResizeArgs('in.gif', 'out.gif', '50%', true)).toEqual([
      'in.gif',
      '-coalesce',
      '-resize',
      '50%',
      '-layers',
      'optimize',
      'out.gif'
    ])
  })
  it('rejects empty / zero specs but accepts real ones', () => {
    expect(isValidResizeSpec('x')).toBe(false)
    expect(isValidResizeSpec('x!')).toBe(false)
    expect(isValidResizeSpec('0%')).toBe(false)
    expect(isValidResizeSpec('NaN%')).toBe(false)
    expect(isValidResizeSpec('50%')).toBe(true)
    expect(isValidResizeSpec('800x600')).toBe(true)
    expect(isValidResizeSpec('800x')).toBe(true)
    expect(isValidResizeSpec('x600')).toBe(true)
  })
})

describe('compress', () => {
  it('builds caesiumclt image args (keeps EXIF)', () => {
    expect(buildCompressArgs('in.jpg', 'C:/tmp', 80)).toEqual([
      '-e',
      '-q',
      '80',
      '-o',
      'C:/tmp',
      'in.jpg'
    ])
  })

  it('lists only the image formats CaesiumCLT actually decodes', () => {
    expect(CAESIUM_EXTS).toEqual(['.jpg', '.png', '.webp', '.gif', '.tiff'])
  })

  it('builds ImageMagick fallback compress args', () => {
    expect(buildMagickCompressArgs('in.avif', 'out.avif', 70)).toEqual([
      'in.avif',
      '-quality',
      '70',
      'out.avif'
    ])
  })

  it('maps quality to a sane CRF (higher quality -> lower CRF)', () => {
    expect(crfForQuality(100)).toBe(18)
    expect(crfForQuality(10)).toBe(32)
    expect(crfForQuality(55)).toBe(25)
    // clamps out-of-range input
    expect(crfForQuality(0)).toBe(32)
    expect(crfForQuality(999)).toBe(18)
  })

  it('builds H.264/AAC video args by default and VP9/Opus for WebM', () => {
    expect(buildVideoCompressArgs('in.mp4', 'out.mp4', 100, false)).toEqual([
      '-y',
      '-i',
      'in.mp4',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      'out.mp4'
    ])
    expect(buildVideoCompressArgs('in.webm', 'out.webm', 100, true)).toEqual([
      '-y',
      '-i',
      'in.webm',
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '18',
      '-c:a',
      'libopus',
      '-b:a',
      '128k',
      'out.webm'
    ])
  })

  it('maps quality to an audio bitrate and picks a codec by extension', () => {
    expect(kbpsForQuality(10)).toBe(64)
    expect(kbpsForQuality(100)).toBe(256)
    expect(buildAudioCompressArgs('in.mp3', 'out.mp3', 100, '.mp3')).toEqual([
      '-y',
      '-i',
      'in.mp3',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '256k',
      'out.mp3'
    ])
    expect(buildAudioCompressArgs('in.ogg', 'out.ogg', 10, '.ogg')).toEqual([
      '-y',
      '-i',
      'in.ogg',
      '-c:a',
      'libvorbis',
      '-b:a',
      '64k',
      'out.ogg'
    ])
  })
})

describe('canCompress', () => {
  it('accepts images, video, and PDF unconditionally', () => {
    expect(canCompress('image', '.png')).toBe(true)
    expect(canCompress('video', '.mp4')).toBe(true)
    expect(canCompress('pdf', '.pdf')).toBe(true)
  })
  it('accepts only lossy audio, not lossless/raw', () => {
    expect(canCompress('audio', '.mp3')).toBe(true)
    expect(canCompress('audio', '.m4a')).toBe(true)
    expect(canCompress('audio', '.flac')).toBe(false)
    expect(canCompress('audio', '.wav')).toBe(false)
  })
  it('rejects documents, text, and unknown kinds', () => {
    expect(canCompress('document', '.docx')).toBe(false)
    expect(canCompress('text', '.txt')).toBe(false)
    expect(canCompress('other', '.bin')).toBe(false)
  })
})
