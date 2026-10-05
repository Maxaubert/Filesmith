import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { findCommand } from '../src/cli/catalog'
import {
  buildGenerateFlags,
  buildOptions,
  type BuildContext,
  type RawFlags
} from '../src/cli/options'
import { DEFAULT_OPTIONS } from '../src/renderer/src/state'

const ctx: BuildContext = {
  cwd: 'C:\\work',
  pathState: (p) => (p.toLowerCase().endsWith('beach.jpg') ? 'file' : 'missing')
}
const build = (path: string, raw: RawFlags) => buildOptions(findCommand(path.split(' '))!, raw, ctx)
const fails = (path: string, raw: RawFlags, re: RegExp) =>
  expect(() => build(path, raw)).toThrow(re)

describe('defaults are the app defaults', () => {
  it('compress', () => expect(build('compress', {}).options).toEqual(DEFAULT_OPTIONS.compress))
  it('removebg', () => expect(build('removebg', {}).options).toEqual(DEFAULT_OPTIONS.removebg))
  it('resize', () => expect(build('resize', {}).options).toMatchObject(DEFAULT_OPTIONS.resize))
  it('upscale', () => expect(build('upscale', {}).options).toMatchObject(DEFAULT_OPTIONS.upscale))
})

describe('convert', () => {
  it('requires --to and normalises aliases', () => {
    fails('convert', {}, /needs --to <format>/)
    expect(build('convert', { to: 'JPEG' }).options.format).toBe('.jpg')
    expect(build('convert', { to: '.TIF' }).options.format).toBe('.tiff')
    fails('convert', { to: 'xyz' }, /Invalid value 'xyz' for --to/)
  })
  it('quality is a preset or 1-100', () => {
    expect(build('convert', { to: 'webp', quality: 'Best' }).options.quality).toBe('best')
    expect(build('convert', { to: 'webp', quality: '70' }).options.quality).toBe(70)
    fails('convert', { to: 'webp', quality: '0' }, /Valid: smaller, balanced, best, or 1-100/)
  })
  it('compression maps to store', () => {
    expect(build('convert', { to: 'cbz' }).options.store).toBe(true)
    expect(build('convert', { to: 'cbz', compression: 'normal' }).options.store).toBe(false)
  })
  it('--out resolves against the working folder', () => {
    expect(build('convert', { to: 'png', out: 'out' }).outDir).toBe(join('C:\\work', 'out'))
  })
})

describe('compress', () => {
  it('--codec goes to the video or audio key by value', () => {
    const v = build('compress', { codec: 'H265' })
    expect(v.options.videoCodec).toBe('h265')
    expect(v.codecFor).toBe('video')
    const a = build('compress', { codec: 'opus' })
    expect(a.options.audioCodec).toBe('opus')
    expect(a.codecFor).toBe('audio')
    fails('compress', { codec: 'h265', 'video-codec': 'av1' }, /--codec or --video-codec, not both/)
  })
  it('accepts the unit the app shows', () => {
    expect(build('compress', { bitrate: '128k' }).options.audioBitrate).toBe(128)
    expect(build('compress', { scale: '50%' }).options.scale).toBe(50)
    fails('compress', { bitrate: '100' }, /Valid: 320, 256, 192, 128, 96, 64/)
    fails('compress', { scale: '52' }, /in steps of 5/)
    fails('compress', { quality: '5' }, /Valid: 10-100/)
  })
  it('greyscale with lossless is a warning, not an error', () => {
    const b = build('compress', { level: 'lossless', greyscale: true })
    expect(b.warnings.map((w) => w.code)).toEqual(['GREYSCALE_IGNORED'])
  })
  it('pdf compress takes only the PDF options', () => {
    expect(build('pdf compress', { level: 'smallest' }).options).toEqual({
      pdfLevel: 'smallest',
      pdfGray: false
    })
  })
})

describe('resize', () => {
  it('infers the mode', () => {
    expect(build('resize', { percent: '25%' }).options).toMatchObject({
      mode: 'percent',
      percent: 25
    })
    expect(build('resize', { width: '1920' }).options).toMatchObject({
      mode: 'dimensions',
      width: 1920,
      height: ''
    })
  })
  it('rejects percent with a dimension and warns on contain with both', () => {
    fails('resize', { percent: '50', width: '10' }, /--percent or --width\/--height, not both/)
    fails('resize', { mode: 'dimensions' }, /needs --width or --height/)
    const b = build('resize', { width: '100', height: '100' })
    expect(b.warnings.map((w) => w.code)).toEqual(['DIMENSION_MAY_BE_IGNORED'])
    expect(build('resize', { width: '100', height: '100', fit: 'stretch' }).warnings).toEqual([])
  })
})

describe('upscale', () => {
  it('maps models, factors and the shown gpu word', () => {
    expect(build('upscale', { factor: '2x' }).options.upscaleFactor).toBe(2)
    expect(build('upscale', { model: 'realesrgan-x4plus-anime_6B' }).options.upscaleModel).toBe(
      'esrgan:realesrgan-x4plus-anime_6B'
    )
    expect(build('upscale', { model: 'Anime' }).options.upscaleModel).toBe('anime')
    expect(build('upscale', { model: 'comfy:4x-Ultra.pth' }).options.upscaleModel).toBe(
      'comfy:4x-Ultra.pth'
    )
    expect(build('upscale', { gpu: 'balanced' }).options.gpuMode).toBe('background')
  })
  it('pid is 4x only', () => {
    expect(build('upscale', { model: 'pid' }).options.upscaleFactor).toBe(4)
    fails('upscale', { model: 'pid', factor: '2' }, /pid upscales 4x only/)
    fails('upscale', { model: 'comfy' }, /Name a ComfyUI model/)
  })
})

describe('removebg', () => {
  it('a colour implies custom and is normalised', () => {
    expect(build('removebg', { color: '00B140' }).options).toMatchObject({
      bgFill: 'custom',
      bgCustomColor: '#00b140'
    })
    fails('removebg', { color: 'red' }, /Use #rrggbb/)
    fails('removebg', { color: '#000000', fill: 'white' }, /--color needs --fill custom/)
  })
  it('an image implies image fill and must exist', () => {
    expect(build('removebg', { image: 'beach.jpg' }).options).toMatchObject({
      bgFill: 'image',
      bgImagePath: join('C:\\work', 'beach.jpg')
    })
    fails('removebg', { image: 'gone.jpg' }, /--image must be an existing image file/)
    fails('removebg', { fill: 'image' }, /--fill image needs --image/)
  })
})

describe('pdf tools', () => {
  it('split needs a valid page range', () => {
    fails('pdf split', {}, /needs --pages/)
    expect(build('pdf split', { pages: ' 1 - 3 , 5' }).options).toEqual({
      op: 'split-range',
      range: '1-3,5'
    })
    fails('pdf split', { pages: 'abc' }, /Invalid value 'abc' for --pages/)
  })
  it('ops', () => {
    expect(build('pdf merge', {}).options).toEqual({ op: 'merge' })
    expect(build('pdf burst', {}).options).toEqual({ op: 'split-pages' })
    expect(build('pdf extract-text', {}).options).toEqual({ op: 'extract-text' })
    expect(build('pdf extract-images', {}).options).toEqual({ op: 'extract-images' })
    expect(build('pdf to-images', { dpi: '200' }).options).toEqual({
      op: 'pages-to-images',
      dpi: 200
    })
  })
})

describe('generate', () => {
  const gen = findCommand(['generate'])!
  it('prompt, size, overrides and defaults', () => {
    const g = buildGenerateFlags(gen, { size: '1216x832', height: '640' }, ['a', 'red kettle'], ctx)
    expect(g).toMatchObject({
      prompt: 'a red kettle',
      width: 1216,
      height: 640,
      sizeExplicit: true,
      seed: -1,
      count: 1,
      style: 'none',
      tryAnyway: false
    })
    expect(buildGenerateFlags(gen, {}, ['x'], ctx)).toMatchObject({
      width: 1024,
      height: 1024,
      sizeExplicit: false
    })
  })
  it('usage errors', () => {
    expect(() => buildGenerateFlags(gen, {}, [], ctx)).toThrow(/needs a prompt/)
    expect(() => buildGenerateFlags(gen, { size: 'big' }, ['x'], ctx)).toThrow(/Use WxH/)
    expect(() => buildGenerateFlags(gen, { count: '9' }, ['x'], ctx)).toThrow(/Valid: 1-8/)
    expect(() => buildGenerateFlags(gen, { cfg: '7.3' }, ['x'], ctx)).toThrow(/in steps of 0.5/)
  })
})
