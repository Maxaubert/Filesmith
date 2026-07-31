// Text-to-image generation via a headless ComfyUI. We don't parse the user's
// arbitrary UI workflows (node ids/structure vary wildly); instead we ship a
// known-good API-format workflow template and inject the user's params + their
// own checkpoint. SDXL first (a single-file checkpoint = simplest robust graph).

export interface GenerateOptions {
  /** Checkpoint filename as ComfyUI sees it (models/checkpoints/<name>). */
  model: string
  prompt: string
  negative: string
  /** Style preset id, folded into the prompt (see GEN_STYLES). */
  style: string
  width: number
  height: number
  /** How many images to make from this prompt (1..8). */
  count: number
  steps: number
  cfg: number
  /** FluxGuidance value for Flux 1/2 (ignored by other arches). */
  guidance?: number
  /** -1 = random each run. */
  seed: number
}

export const GEN_DEFAULTS: Omit<GenerateOptions, 'model' | 'prompt'> = {
  negative: 'blurry, low quality, watermark, text',
  style: 'none',
  width: 1024,
  height: 1024,
  count: 1,
  steps: 28,
  cfg: 7,
  guidance: 3.5,
  seed: -1
}

export const GEN_MAX_COUNT = 8

/** Style presets. The chosen style's text is appended to the prompt (and any
 * negative to the negative), so it composes with whatever the user typed. */
export interface GenStyle {
  id: string
  label: string
  positive: string
  negative?: string
}
export const GEN_STYLES: GenStyle[] = [
  { id: 'none', label: 'None', positive: '' },
  {
    id: 'realistic',
    label: 'Realistic',
    positive: 'photorealistic, highly detailed, sharp focus, natural lighting, 8k',
    negative: 'cartoon, illustration, painting, anime'
  },
  {
    id: 'photo',
    label: 'Photographic',
    positive: 'professional photograph, DSLR, 50mm, shallow depth of field, cinematic lighting, film grain',
    negative: 'illustration, cartoon, 3d render'
  },
  {
    id: 'anime',
    label: 'Anime',
    positive: 'anime style, cel shading, clean line art, vibrant colors, studio quality',
    negative: 'photorealistic, 3d render'
  },
  {
    id: 'artsy',
    label: 'Artsy',
    positive: 'digital painting, concept art, artstation, dramatic lighting, expressive brushwork',
    negative: ''
  },
  {
    id: '3d',
    label: '3D Render',
    positive: '3d render, octane render, physically based rendering, subsurface scattering, high detail',
    negative: ''
  },
  {
    id: 'fantasy',
    label: 'Fantasy',
    positive: 'fantasy art, epic, ethereal, intricate detail, magical atmosphere, volumetric light',
    negative: ''
  }
]

/** Aspect presets at SDXL-friendly resolutions; a "Custom" entry in the UI lets
 * the user set any width/height. */
export const GEN_SIZES: { label: string; width: number; height: number }[] = [
  { label: 'Square 1:1 · 1024', width: 1024, height: 1024 },
  { label: 'Portrait 2:3 · 832×1216', width: 832, height: 1216 },
  { label: 'Landscape 3:2 · 1216×832', width: 1216, height: 832 },
  { label: 'Portrait 9:16 · 768×1344', width: 768, height: 1344 },
  { label: 'Landscape 16:9 · 1344×768', width: 1344, height: 768 },
  { label: 'Portrait 4:5 · 896×1152', width: 896, height: 1152 },
  { label: 'Landscape 5:4 · 1152×896', width: 1152, height: 896 }
]

/** Clamp a custom dimension to a sane, model-friendly range (multiple of 8). */
export function clampDim(n: number): number {
  const v = Math.round((Number.isFinite(n) ? n : 1024) / 8) * 8
  return Math.max(256, Math.min(2048, v))
}
