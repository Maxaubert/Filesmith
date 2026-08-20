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
  /** Run an unrecognized model through a generic graph instead of refusing. */
  tryAnyway?: boolean
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
    positive:
      'professional photograph, DSLR, 50mm, shallow depth of field, cinematic lighting, film grain',
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
    positive:
      '3d render, octane render, physically based rendering, subsurface scattering, high detail',
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

/** Per-architecture dimension limits, from the registry's `capabilities`. */
export interface DimCaps {
  minDim?: number
  maxDim?: number
  dimStep?: number
}

export const DEFAULT_DIM_CAPS: Required<DimCaps> = { minDim: 256, maxDim: 2048, dimStep: 8 }

/**
 * Clamp a custom dimension to a model-friendly range.
 *
 * The limits come from the model's own registry entry rather than one global
 * 2048 ceiling. That ceiling was a guess about SDXL that then applied to every
 * architecture — including ones whose native resolution is higher, which were
 * silently capped below what they were trained for.
 */
export function clampDim(n: number, caps?: DimCaps): number {
  const min = caps?.minDim ?? DEFAULT_DIM_CAPS.minDim
  const max = caps?.maxDim ?? DEFAULT_DIM_CAPS.maxDim
  const step = caps?.dimStep && caps.dimStep > 0 ? caps.dimStep : DEFAULT_DIM_CAPS.dimStep
  const v = Math.round((Number.isFinite(n) ? n : 1024) / step) * step
  return Math.max(min, Math.min(max, v))
}
