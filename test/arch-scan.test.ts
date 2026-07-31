import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  classifyArch,
  classifyModelFile,
  inspectModelFile,
  isAllInOne,
  isExcludedNonImage,
  readSafetensorsHeader
} from '../src/main/generate/archScan'

const dir = mkdtempSync(join(tmpdir(), 'arch-scan-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Write a minimal valid safetensors file: 8-byte LE header length + JSON. The
 * tensor entries are empty objects (we only read key names, never data). */
function writeSafetensors(name: string, keys: string[], meta?: Record<string, string>): string {
  const header: Record<string, unknown> = {}
  if (meta) header.__metadata__ = meta
  for (const k of keys) header[k] = { dtype: 'F16', shape: [1], data_offsets: [0, 2] }
  const json = Buffer.from(JSON.stringify(header), 'utf-8')
  const len = Buffer.allocUnsafe(8)
  len.writeBigUInt64LE(BigInt(json.length))
  const path = join(dir, name)
  writeFileSync(path, Buffer.concat([len, json, Buffer.from([0, 0])]))
  return path
}

describe('readSafetensorsHeader', () => {
  it('reads keys and metadata, excluding __metadata__', () => {
    const p = writeSafetensors('m.safetensors', ['a.weight', 'b.bias'], { 'modelspec.architecture': 'X' })
    const h = readSafetensorsHeader(p)
    expect(h?.keys.sort()).toEqual(['a.weight', 'b.bias'])
    expect(h?.metadata['modelspec.architecture']).toBe('X')
  })

  it('returns null for a too-small / non-safetensors file', () => {
    const p = join(dir, 'junk.bin')
    writeFileSync(p, Buffer.from([1, 2, 3]))
    expect(readSafetensorsHeader(p)).toBeNull()
  })

  it('returns null when the header length overruns the file', () => {
    const p = join(dir, 'bad-len.safetensors')
    const len = Buffer.allocUnsafe(8)
    len.writeBigUInt64LE(BigInt(9_999_999))
    writeFileSync(p, Buffer.concat([len, Buffer.from('{}')]))
    expect(readSafetensorsHeader(p)).toBeNull()
  })
})

describe('classifyArch', () => {
  const cases: [string, string[], string][] = [
    ['flux1', ['double_blocks.0.img_attn.qkv.weight', 'single_blocks.0.linear1.weight', 'img_in.weight', 'txt_in.weight'], 'flux1'],
    [
      'flux2',
      ['double_blocks.0.x.weight', 'single_blocks.0.x.weight', 'double_stream_modulation_img.0.weight', 'img_in.weight', 'txt_in.weight'],
      'flux2'
    ],
    ['sd3', ['joint_blocks.0.x_block.attn.qkv.weight'], 'sd3'],
    ['z-image', ['cap_embedder.0.weight', 'noise_refiner.0.weight', 'context_refiner.0.weight'], 'z-image'],
    ['sdxl', ['input_blocks.0.0.weight', 'middle_block.1.weight'], 'sdxl'],
    ['krea2', ['blocks.0.weight', 'tmlp.0.weight', 'txtfusion.0.weight', 'tproj.weight'], 'krea2'],
    ['genuinely unknown', ['foo.0.weight', 'bar.baz.weight'], 'unknown'],
    // Regression: non-image DiTs that reuse Flux's block names must NOT be Flux.
    [
      'HunyuanVideo (flux-like blocks + token refiner)',
      ['double_blocks.0.w', 'single_blocks.0.w', 'img_in.weight', 'txt_in.individual_token_refiner.blocks.0.w', 'guidance_in.w'],
      'unknown'
    ],
    [
      'Hunyuan3D (flux-like blocks, no img_in/txt_in)',
      ['double_blocks.0.w', 'single_blocks.0.w', 'conditioner.w', 'patch_embed.w', 'time_in.w'],
      'unknown'
    ],
    ['FramePack (clean_x_embedder)', ['clean_x_embedder.w', 'double_blocks.0.w', 'img_in.w', 'txt_in.w'], 'unknown']
  ]
  for (const [label, keys, expected] of cases) {
    it(`classifies ${label} as ${expected}`, () => {
      expect(classifyArch({ keys, metadata: {} })).toBe(expected)
    })
  }

  it('prefers flux2 over flux1 when modulation keys are present', () => {
    const keys = ['double_blocks.0.w', 'single_blocks.0.w', 'single_stream_modulation.0.w', 'img_in.w', 'txt_in.w']
    expect(classifyArch({ keys, metadata: {} })).toBe('flux2')
  })

  it('rejects a model whose metadata names a video family, even with image-like keys', () => {
    const keys = ['double_blocks.0.w', 'single_blocks.0.w', 'img_in.w', 'txt_in.w']
    expect(classifyArch({ keys, metadata: { 'modelspec.architecture': 'hunyuan-video' } })).toBe('unknown')
  })

  it('treats Lumina 2 (declares lumina) as unknown so it is not mis-wired as Z-Image', () => {
    const keys = ['cap_embedder.0.w', 'noise_refiner.0.w', 'context_refiner.0.w']
    expect(classifyArch({ keys, metadata: { 'modelspec.architecture': 'Lumina-Image-2.0' } })).toBe('unknown')
    // Without the metadata it would (correctly, for real Z-Image) be z-image.
    expect(classifyArch({ keys, metadata: {} })).toBe('z-image')
  })
})

describe('isExcludedNonImage', () => {
  const yes: [string, string[], Record<string, string>?][] = [
    ['HunyuanVideo token refiner', ['double_blocks.0.w', 'img_in.w', 'txt_in.individual_token_refiner.w']],
    ['Wan video patch/time embed', ['patch_embedding.w', 'time_embedding.w', 'blocks.0.w']],
    ['LTX vocoder/audio', ['vocoder.w', 'audio_vae.w', 'model.w']],
    ['Hunyuan3D shape DiT', ['double_blocks.0.w', 'single_blocks.0.w', 'conditioner.w']],
    ['metadata video', ['x.w'], { 'modelspec.architecture': 'wan-2.2' }]
  ]
  for (const [label, keys, metadata] of yes)
    it(`excludes ${label}`, () => expect(isExcludedNonImage({ keys, metadata: metadata ?? {} })).toBe(true))

  it('does NOT exclude a real Flux or Z-Image', () => {
    expect(isExcludedNonImage({ keys: ['double_blocks.0.w', 'single_blocks.0.w', 'img_in.w', 'txt_in.w'], metadata: {} })).toBe(false)
    expect(isExcludedNonImage({ keys: ['cap_embedder.0.w', 'noise_refiner.0.w', 'context_refiner.0.w'], metadata: {} })).toBe(false)
  })
})

describe('isAllInOne', () => {
  it('detects a baked text-encoder + VAE checkpoint', () => {
    const h = { keys: ['model.diffusion_model.x', 'text_encoders.t5.w', 'vae.decoder.w'], metadata: {} }
    expect(isAllInOne(h)).toBe(true)
  })
  it('is false for a bare UNET', () => {
    expect(isAllInOne({ keys: ['double_blocks.0.w', 'single_blocks.0.w'], metadata: {} })).toBe(false)
  })
})

describe('classifyModelFile', () => {
  it('classifies from a real file end-to-end', () => {
    const p = writeSafetensors('flux.safetensors', ['double_blocks.0.w', 'single_blocks.0.w', 'img_in.w', 'txt_in.w'])
    expect(classifyModelFile(p)).toBe('flux1')
  })
  it('returns unknown for an unreadable path', () => {
    expect(classifyModelFile(join(dir, 'nope.safetensors'))).toBe('unknown')
  })
})

describe('inspectModelFile', () => {
  it('reports arch + excluded together', () => {
    const flux = writeSafetensors('f2.safetensors', ['double_blocks.0.w', 'single_blocks.0.w', 'img_in.w', 'txt_in.w'])
    expect(inspectModelFile(flux)).toMatchObject({ arch: 'flux1', excluded: false })

    const video = writeSafetensors('v.safetensors', ['patch_embedding.w', 'time_embedding.w', 'blocks.0.w'])
    expect(inspectModelFile(video)).toMatchObject({ arch: 'unknown', excluded: true })

    const mystery = writeSafetensors('m.safetensors', ['some_new_dit.0.w'])
    expect(inspectModelFile(mystery)).toMatchObject({ arch: 'unknown', excluded: false })
  })

  it('returns the header so an unrecognized file can be re-tried against the registry', () => {
    // Registry-declared `detect` blocks need the tensor keys; without this the
    // caller would pay a second multi-hundred-KB header read per unknown model.
    const mystery = writeSafetensors('m2.safetensors', ['some_new_dit.0.w'])
    expect(inspectModelFile(mystery).header?.keys).toEqual(['some_new_dit.0.w'])
  })
})
