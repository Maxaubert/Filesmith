import { describe, expect, it } from 'vitest'
import { requiredCompanions } from '../src/main/generate/archRegistry'

describe('requiredCompanions', () => {
  it('flux1 needs T5-XXL, CLIP-L, and the Flux VAE', () => {
    const c = requiredCompanions('flux1', 'flux1-dev.safetensors')
    expect(c.map((x) => x.download.filename).sort()).toEqual(
      ['ae.safetensors', 'clip_l.safetensors', 't5xxl_fp8_e4m3fn_scaled.safetensors'].sort()
    )
  })

  it('z-image needs Qwen3-4B and the Flux VAE (not the Qwen VAE)', () => {
    const c = requiredCompanions('z-image', 'z_image_turbo_bf16.safetensors')
    const files = c.map((x) => x.download.filename)
    expect(files).toContain('qwen_3_4b.safetensors')
    expect(files).toContain('ae.safetensors')
  })

  it('krea2 needs the Qwen3-VL encoder and the Qwen-Image VAE', () => {
    const files = requiredCompanions('krea2', 'krea2_turbo.safetensors').map(
      (x) => x.download.filename
    )
    expect(files).toContain('qwen3vl_4b_fp8_scaled.safetensors')
    expect(files).toContain('qwen_image_vae.safetensors')
  })

  it('flux2 picks the encoder from BYTE SIZE, not the filename (rename-safe)', () => {
    // A 9B model renamed without a "9b" token still gets the 8B encoder by size.
    const big = requiredCompanions('flux2', 'flux2_klein.safetensors', 8_800_000_000)
    expect(big.map((x) => x.download.filename)).toContain('qwen_3_8b_fp8mixed.safetensors')

    const small = requiredCompanions('flux2', 'flux2_klein.safetensors', 3_800_000_000)
    expect(small.map((x) => x.download.filename)).toContain('qwen_3_4b.safetensors')

    // Falls back to the filename token when size is unknown.
    expect(
      requiredCompanions('flux2', 'flux-2-klein-9b-fp8.safetensors').map((x) => x.download.filename)
    ).toContain('qwen_3_8b_fp8mixed.safetensors')
  })

  it('every flux2 variant also needs the flux2 VAE', () => {
    for (const size of [3_800_000_000, 8_800_000_000]) {
      const files = requiredCompanions('flux2', 'm.safetensors', size).map(
        (x) => x.download.filename
      )
      expect(files).toContain('flux2-vae.safetensors')
    }
  })
})
