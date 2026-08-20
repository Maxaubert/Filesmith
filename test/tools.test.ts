import { describe, expect, it } from 'vitest'
import {
  buildFfmpegArgs,
  buildMagickArgs,
  ffmpegExtraFor,
  magickQualityArgs
} from '../src/main/tools/convert'
import {
  categoryFormats,
  convertTargets,
  isSameFormat,
  magickExtraFor,
  toolForKind
} from '../src/shared/convert'
import { buildResizeArgs, buildResizeSpec, isValidResizeSpec } from '../src/main/tools/resize'
import {
  audioOutputExt,
  buildAudioCompressArgs,
  buildCompressArgs,
  buildMagickCompressArgs,
  buildVideoCompressArgs,
  crfForCodec,
  CAESIUM_EXTS
} from '../src/main/tools/compress'
import { buildGsCompressArgs } from '../src/main/tools/pdf'
import { scaleResolution } from '../src/shared/compress'
import { canCompress } from '../src/shared/convert'
import {
  buildPdfMergeArgs,
  buildPdfPagesArgs,
  buildPdfExtractArgs,
  buildPdfInfoArgs,
  normalizePageRange,
  parsePdfPageCount
} from '../src/main/tools/pdf'
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
  it('appends ! when stretching to both numbers', () => {
    expect(buildResizeSpec({ mode: 'dimensions', width: 800, height: 600, fit: 'stretch' })).toBe(
      '800x600!'
    )
  })
  it('does not stretch against a blank field (nothing to distort to)', () => {
    expect(buildResizeSpec({ mode: 'dimensions', width: 800, height: '', fit: 'stretch' })).toBe(
      '800x'
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

  it('lists only the image formats CaesiumCLT actually decodes (no tiff)', () => {
    // Verified against the bundled binary: it errors on TIFF, which therefore
    // must route to ImageMagick instead.
    expect(CAESIUM_EXTS).toEqual(['.jpg', '.png', '.webp', '.gif'])
    expect(CAESIUM_EXTS).not.toContain('.tiff')
  })

  it('builds ImageMagick compress/convert args, frame-aware by target', () => {
    // Multi-frame target (webp/avif/gif/tiff): keep all frames (no [0]) so an
    // animated GIF -> WebP stays animated.
    expect(buildMagickCompressArgs('in.gif', 'out.webp', 70)).toEqual([
      'in.gif',
      '-quality',
      '70',
      'out.webp'
    ])
    // Single-frame target: read only the first frame so it doesn't split.
    expect(buildMagickCompressArgs('in.gif', 'out.jpg', 70)).toEqual([
      'in.gif[0]',
      '-quality',
      '70',
      'out.jpg'
    ])
  })

  it('maps quality to a per-codec CRF (higher quality -> lower CRF)', () => {
    // x264/x265 range 18-32
    expect(crfForCodec('h264', 100)).toBe(18)
    expect(crfForCodec('h265', 10)).toBe(32)
    // av1 range 28-50
    expect(crfForCodec('av1', 100)).toBe(28)
    expect(crfForCodec('av1', 10)).toBe(50)
    // clamps out-of-range
    expect(crfForCodec('h264', 0)).toBe(32)
    expect(crfForCodec('h264', 999)).toBe(18)
  })

  it('builds video args per codec, output always mp4', () => {
    expect(
      buildVideoCompressArgs('in.mkv', 'out.mp4', { codec: 'h264', quality: 100, scale: 100 })
    ).toEqual([
      '-y',
      '-i',
      'in.mkv',
      // every audio track, not just the "best" one; subs stay behind (PGS
      // cannot become mov_text and would fail the job)
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      'out.mp4'
    ])
    // H.265 adds the hvc1 tag; AV1 uses libsvtav1 + numeric preset
    expect(
      buildVideoCompressArgs('in.mp4', 'out.mp4', { codec: 'h265', quality: 100, scale: 100 })
    ).toContain('hvc1')
    const av1 = buildVideoCompressArgs('in.mp4', 'out.mp4', {
      codec: 'av1',
      quality: 100,
      scale: 100
    })
    expect(av1).toContain('libsvtav1')
    expect(av1.join(' ')).toContain('-preset 6')
  })

  it('adds an aspect-safe percentage scale filter below 100%', () => {
    const a = buildVideoCompressArgs('in.mp4', 'out.mp4', {
      codec: 'h264',
      quality: 80,
      scale: 50
    })
    expect(a).toContain('-vf')
    // trunc(x/2)*2 in the expression: `force_divisible_by` is honoured only
    // inside the force_original_aspect_ratio branch, so odd results (854 x
    // 0.25 = 213) aborted the encode with "width not divisible by 2".
    expect(a[a.indexOf('-vf') + 1]).toBe('scale=w=trunc(iw*0.5/2)*2:h=trunc(ih*0.5/2)*2')
    // 100% (original) adds no filter at all
    const b = buildVideoCompressArgs('in.mp4', 'out.mp4', {
      codec: 'h264',
      quality: 80,
      scale: 100
    })
    expect(b).not.toContain('-vf')
  })

  it('builds audio args for a target codec + bitrate, keep uses source codec', () => {
    expect(
      buildAudioCompressArgs('in.wav', 'out.opus', {
        codec: 'opus',
        bitrate: 96,
        sourceExt: '.wav'
      })
    ).toEqual(['-y', '-i', 'in.wav', '-map', '0:a', '-c:a', 'libopus', '-b:a', '96k', 'out.opus'])
    expect(
      buildAudioCompressArgs('in.ogg', 'out.ogg', {
        codec: 'keep',
        bitrate: 128,
        sourceExt: '.ogg'
      })
    ).toEqual(['-y', '-i', 'in.ogg', '-map', '0:a', '-c:a', 'libvorbis', '-b:a', '128k', 'out.ogg'])
    expect(audioOutputExt('mp3', '.m4a')).toBe('.mp3')
    expect(audioOutputExt('aac', '.wav')).toBe('.m4a')
    expect(audioOutputExt('keep', '.ogg')).toBe('.ogg')
    // keep on a codec with no encoder entry must move to a container that
    // matches the AAC fallback (.amr kept its ext and failed to mux)
    expect(audioOutputExt('keep', '.amr')).toBe('.m4a')
    expect(audioOutputExt('keep', '.ac3')).toBe('.ac3')
    // cover art rides across un-re-encoded where the container supports it;
    // without the map ffmpeg re-encoded a JPEG cover into a PNG 3x the source
    expect(
      buildAudioCompressArgs('in.mp3', 'out.mp3', {
        codec: 'keep',
        bitrate: 128,
        sourceExt: '.mp3'
      })
    ).toEqual([
      '-y',
      '-i',
      'in.mp3',
      '-map',
      '0:a',
      '-map',
      '0:v?',
      '-c:v',
      'copy',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      'out.mp3'
    ])
  })

  it('builds Ghostscript PDF compress args per level + grayscale', () => {
    const bal = buildGsCompressArgs('in.pdf', 'out.pdf', 'balanced', false)
    expect(bal).toContain('-sDEVICE=pdfwrite')
    expect(bal).toContain('-dPDFSETTINGS=/ebook')
    expect(bal).toContain('-sOutputFile=out.pdf')
    expect(bal).not.toContain('-sColorConversionStrategy=Gray')
    expect(buildGsCompressArgs('in.pdf', 'out.pdf', 'smallest', false)).toContain(
      '-dPDFSETTINGS=/screen'
    )
    expect(buildGsCompressArgs('in.pdf', 'out.pdf', 'high', true)).toContain(
      '-sColorConversionStrategy=Gray'
    )
  })
})

describe('scaleResolution', () => {
  it('scales by percent, preserving aspect ratio, with even dims', () => {
    expect(scaleResolution(1920, 1080, 50)).toEqual({ w: 960, h: 540 })
    expect(scaleResolution(1080, 1920, 50)).toEqual({ w: 540, h: 960 }) // portrait
    expect(scaleResolution(2560, 1080, 50)).toEqual({ w: 1280, h: 540 }) // ultrawide
  })
  it('rounds to even and passes through at 100%', () => {
    expect(scaleResolution(1921, 1081, 50)).toEqual({ w: 960, h: 540 }) // even
    expect(scaleResolution(1920, 1080, 100)).toEqual({ w: 1920, h: 1080 })
  })
})

describe('pdf ops', () => {
  it('builds merge args (ordered inputs after -o)', () => {
    expect(buildPdfMergeArgs(['a.pdf', 'b.pdf', 'c.pdf'], 'out.pdf')).toEqual([
      'merge',
      '-o',
      'out.pdf',
      'a.pdf',
      'b.pdf',
      'c.pdf'
    ])
  })
  it('builds page-range/keep args and single-page split args', () => {
    expect(buildPdfPagesArgs('in.pdf', 'out.pdf', '1-3,5')).toEqual([
      'clean',
      'in.pdf',
      'out.pdf',
      '1-3,5'
    ])
    expect(buildPdfPagesArgs('in.pdf', 'p-04.pdf', '4')).toEqual([
      'clean',
      'in.pdf',
      'p-04.pdf',
      '4'
    ])
  })
  it('builds info + extract args', () => {
    expect(buildPdfInfoArgs('in.pdf')).toEqual(['info', 'in.pdf'])
    expect(buildPdfExtractArgs('in.pdf')).toEqual(['extract', 'in.pdf'])
  })
  it('parses page count from mutool info output', () => {
    expect(parsePdfPageCount('Info object (500 0 R):\nPages: 12\nRetrieved 3 fonts')).toBe(12)
    expect(parsePdfPageCount('no pages line here')).toBe(0)
  })
  it('normalizes valid page ranges and rejects garbage', () => {
    expect(normalizePageRange('1-3,5')).toBe('1-3,5')
    expect(normalizePageRange(' 2 - 4 , 7 ')).toBe('2-4,7')
    expect(normalizePageRange('8')).toBe('8')
    expect(normalizePageRange('')).toBeNull()
    expect(normalizePageRange('abc')).toBeNull()
    expect(normalizePageRange('1;2')).toBeNull()
    expect(normalizePageRange('1-')).toBeNull()
  })
})

describe('canCompress', () => {
  it('accepts video and PDF unconditionally', () => {
    expect(canCompress('video', '.mp4')).toBe(true)
    expect(canCompress('video', '.vob')).toBe(true)
    expect(canCompress('pdf', '.pdf')).toBe(true)
  })
  it('accepts raster images the compressors handle, not vector/exotic exts', () => {
    for (const e of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff', '.avif', '.jxl'])
      expect(canCompress('image', e)).toBe(true)
    // vector / layered / exotic: would silently rasterize -> excluded
    expect(canCompress('image', '.svg')).toBe(false)
    expect(canCompress('image', '.xcf')).toBe(false)
    expect(canCompress('image', '.tga')).toBe(false)
    expect(canCompress('image', '.ppm')).toBe(false)
    // HEIC/HEIF: the bundled magick has no HEIC encoder (exit 0 + junk file);
    // BMP: uncompressed, a "compress" would be a no-op at every quality
    expect(canCompress('image', '.heic')).toBe(false)
    expect(canCompress('image', '.heif')).toBe(false)
    expect(canCompress('image', '.bmp')).toBe(false)
  })
  it('accepts all audio, including lossless (flac/wav -> opus is a big win)', () => {
    expect(canCompress('audio', '.mp3')).toBe(true)
    expect(canCompress('audio', '.m4a')).toBe(true)
    expect(canCompress('audio', '.flac')).toBe(true)
    expect(canCompress('audio', '.wav')).toBe(true)
  })

  it('routes "keep format" on lossless audio to FLAC, not a bitrate', () => {
    // A bitrate is meaningless for wav/flac, so keep-format means lossless FLAC.
    expect(audioOutputExt('keep', '.wav')).toBe('.flac')
    expect(audioOutputExt('keep', '.flac')).toBe('.flac')
    expect(
      buildAudioCompressArgs('in.wav', 'out.flac', {
        codec: 'keep',
        bitrate: 192,
        sourceExt: '.wav'
      })
    ).toEqual([
      '-y',
      '-i',
      'in.wav',
      '-map',
      '0:a',
      '-map',
      '0:v?',
      '-c:v',
      'copy',
      '-c:a',
      'flac',
      '-compression_level',
      '8',
      'out.flac'
    ])
    // an explicit lossy codec still applies the bitrate (opus: cover dropped,
    // the ogg container takes no attached-picture stream copy)
    expect(
      buildAudioCompressArgs('in.wav', 'out.opus', {
        codec: 'opus',
        bitrate: 96,
        sourceExt: '.wav'
      })
    ).toEqual(['-y', '-i', 'in.wav', '-map', '0:a', '-c:a', 'libopus', '-b:a', '96k', 'out.opus'])
  })
  it('rejects documents, text, and unknown kinds', () => {
    expect(canCompress('document', '.docx')).toBe(false)
    expect(canCompress('text', '.txt')).toBe(false)
    expect(canCompress('other', '.bin')).toBe(false)
  })
})

describe('per-target convert args', () => {
  it('applies -quality only to lossy image targets', () => {
    expect(magickQualityArgs('.jpg', 'balanced')).toEqual(['-quality', '82'])
    expect(magickQualityArgs('.webp', 'smaller')).toEqual(['-quality', '60'])
    // PNG: -quality is zlib-level+filter, not a lossy dial - the old default
    // (82) produced the LARGEST file. Max deflate instead.
    expect(magickQualityArgs('.png', 'balanced')).toEqual(['-define', 'png:compression-level=9'])
    // no meaningful dial for these
    expect(magickQualityArgs('.gif', 'best')).toEqual([])
    expect(magickQualityArgs('.ico', 'best')).toEqual([])
  })

  it('gives video targets real encoder settings instead of bare defaults', () => {
    // GIF: palette pass + fps cap + width bound (bare defaults: ~75 MB/min)
    const gif = ffmpegExtraFor('video', '.gif')
    expect(gif).toContain('-filter_complex')
    expect(gif.join(' ')).toContain('palettegen')
    expect(gif).toContain('-an')
    // WebM: vp9 with row-mt and a realtime-capable cpu-used (0 ran 0.66x)
    const webm = ffmpegExtraFor('video', '.webm')
    expect(webm).toContain('libvpx-vp9')
    expect(webm.join(' ')).toContain('-row-mt 1')
    // AVI: not mpeg4's worst quantizer
    expect(ffmpegExtraFor('video', '.avi').join(' ')).toContain('-q:v 5')
    // MKV keeps subtitles by stream copy; MP4 keeps all audio, no subs
    expect(ffmpegExtraFor('video', '.mkv').join(' ')).toContain('-map 0:s? -c:s copy')
    expect(ffmpegExtraFor('video', '.mp4')).toEqual(['-map', '0:v:0', '-map', '0:a?'])
    // audio convert carries cover art where the container supports it
    expect(ffmpegExtraFor('audio', '.mp3')).toEqual(['-map', '0:a', '-map', '0:v?', '-c:v', 'copy'])
    expect(ffmpegExtraFor('audio', '.ogg')).toEqual(['-map', '0:a'])
  })

  it('rejects zero and negative resize dimensions', () => {
    // 0x made magick exit 0 with a 1x1 image; -5x silently copied unchanged
    expect(isValidResizeSpec('0x')).toBe(false)
    expect(isValidResizeSpec('x0')).toBe(false)
    expect(isValidResizeSpec('-5x')).toBe(false)
    expect(isValidResizeSpec('800x')).toBe(true)
    expect(isValidResizeSpec('800x600!')).toBe(true)
  })
})
