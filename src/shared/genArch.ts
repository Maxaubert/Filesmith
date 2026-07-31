// Multi-architecture ComfyUI text-to-image workflow builders. Each modern
// diffusion family (Flux 1/2, Z-Image, Krea 2) loads through its own node chain
// and demands specific sampler settings (cfg MUST be 1 for all of these — real
// guidance lives in FluxGuidance or is baked into the turbo distillation). The
// graphs here are the canonical API-format templates, verified against ComfyUI
// docs/examples. SDXL's single-file-checkpoint graph stays in generate.ts.

import type { GenerateOptions } from './generate'
import { GEN_STYLES, GEN_MAX_COUNT, clampDim } from './generate'

/** Architectures we can build a generation workflow for. 'sdxl' = the classic
 * single-file checkpoint (CheckpointLoaderSimple); the rest are diffusion models
 * loaded via UNETLoader + separate text-encoder/VAE. */
export type GenArch = 'sdxl' | 'flux1' | 'flux2' | 'z-image' | 'krea2'

export interface ArchInfo {
  /** Group heading in the model picker. */
  group: string
  /** Fixed sampler settings for this arch (cfg is non-negotiable per family). */
  sampler: string
  scheduler: string
  steps: number
  cfg: number
  /** FluxGuidance value; 0 = no guidance node (turbo/distilled). */
  guidance: number
  /** Whether the Advanced panel should expose a Guidance control. */
  hasGuidance: boolean
  /** A short note about ComfyUI version needs, surfaced if a load fails. */
  minComfyNote?: string
}

export const ARCH_INFO: Record<GenArch, ArchInfo> = {
  sdxl: { group: 'Checkpoints', sampler: 'dpmpp_2m', scheduler: 'karras', steps: 28, cfg: 7, guidance: 0, hasGuidance: false },
  flux1: { group: 'Flux', sampler: 'euler', scheduler: 'simple', steps: 20, cfg: 1, guidance: 3.5, hasGuidance: true },
  flux2: {
    group: 'Flux 2',
    sampler: 'euler',
    scheduler: 'simple',
    steps: 4,
    cfg: 1,
    guidance: 4,
    hasGuidance: true,
    minComfyNote: 'Flux 2 needs a ComfyUI from late November 2025 or newer.'
  },
  'z-image': {
    group: 'Z-Image',
    sampler: 'res_multistep',
    scheduler: 'simple',
    steps: 8,
    cfg: 1,
    guidance: 0,
    hasGuidance: false,
    minComfyNote: 'Z-Image needs a recent ComfyUI (v0.6.0+, late November 2025).'
  },
  krea2: {
    group: 'Krea 2',
    sampler: 'euler',
    scheduler: 'simple',
    steps: 8,
    cfg: 1,
    guidance: 0,
    hasGuidance: false,
    minComfyNote: 'Krea 2 needs an up-to-date ComfyUI (nightly, mid-2026) for the krea2 encoder type.'
  }
}

/** A downloadable companion file (text encoder / VAE) the user is missing. */
export interface MissingFile {
  label: string
  filename: string
  url: string
  approxSize: string
  subdir: 'text_encoders' | 'vae'
}

/** One entry in the generation model picker. */
export interface GenModel {
  /** ComfyUI-relative name: checkpoints/ for a checkpoint, diffusion_models/ else. */
  name: string
  /** Display label (basename, no extension). */
  label: string
  arch: GenArch
  /** How the model loads: a single-file checkpoint (CheckpointLoaderSimple) or a
   * bare diffusion model (UNETLoader + separate encoders/VAE). */
  source: 'checkpoint' | 'diffusion'
  /** Picker group heading (ARCH_INFO[arch].group). */
  group: string
  /** Ready to generate now. */
  runnable: boolean
  /** When not runnable: a short reason (missing files, unsupported, etc.). */
  reason?: string
  /** Missing companions that can be downloaded to make it runnable. */
  missing?: MissingFile[]
  /** Loader wiring for the builder (present when runnable and source === diffusion). */
  wiring?: DiffusionWiring
  /** The ComfyUI models/ dir this model lives under (companion downloads target it). */
  baseDir?: string
  /** What the file actually probed as, when that is not a family we can wire up
   * ('unknown', 'sd3', a video DiT, …). Present only on non-runnable models, and
   * shown to the user — a file we cannot run is still worth naming. */
  detectedArch?: string
  /** Probed as a non-image model (video/3D/audio). Listed, but discouraged. */
  notImage?: boolean
}

/** Result of scanning for generation models, with counts for models we saw but
 * can't offer, so the UI can be honest about them instead of silently dropping. */
export interface GenModelScan {
  models: GenModel[]
  /** Recognized-as-not-image (video/3D) — omitted silently, counted for context. */
  excluded: number
  /** Unreadable/unrecognized architecture in diffusion_models. */
  unrecognized: number
  /** GGUF diffusion models found (not supported yet). */
  gguf: number
}

/** Files a diffusion-model workflow needs, as ComfyUI folder-relative names. */
export interface DiffusionWiring {
  /** diffusion_models/unet filename (UNETLoader). */
  unet: string
  /** Primary text encoder (CLIPLoader clip_name, or DualCLIPLoader clip_name1). */
  clip: string
  /** Second encoder for Flux 1's DualCLIPLoader (clip_name2 = clip_l). */
  clip2?: string
  /** VAE filename (VAELoader). */
  vae: string
}

/** Shared prompt/seed/dimension prep, identical across arches. */
function prep(o: GenerateOptions): {
  positive: string
  negative: string
  seed: number
  count: number
  width: number
  height: number
  steps: number
} {
  const style = GEN_STYLES.find((s) => s.id === o.style)
  const positive = [o.prompt.trim(), style?.positive].filter(Boolean).join(', ')
  const negative = [o.negative.trim(), style?.negative].filter(Boolean).join(', ')
  const seed = o.seed < 0 ? Math.floor(Math.random() * 1_000_000_000) : o.seed
  const count = Math.max(1, Math.min(GEN_MAX_COUNT, Math.round(o.count || 1)))
  return {
    positive,
    negative,
    seed,
    count,
    width: clampDim(o.width),
    height: clampDim(o.height),
    steps: o.steps > 0 ? o.steps : 20
  }
}

/** Flux 1 [dev/schnell]: UNET + DualCLIPLoader(type=flux) + Flux VAE, with a
 * FluxGuidance node on the positive branch and KSampler at cfg 1. */
export function buildFlux1Workflow(o: GenerateOptions, w: DiffusionWiring): Record<string, unknown> {
  const p = prep(o)
  const info = ARCH_INFO.flux1
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: w.unet, weight_dtype: 'default' } },
    '2': {
      class_type: 'DualCLIPLoader',
      inputs: { clip_name1: w.clip, clip_name2: w.clip2 ?? w.clip, type: 'flux' }
    },
    '3': { class_type: 'VAELoader', inputs: { vae_name: w.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: ['2', 0] } },
    '5': { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance: o.guidance ?? info.guidance } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: ['2', 0] } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width: p.width, height: p.height, batch_size: p.count } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        seed: p.seed,
        steps: p.steps,
        cfg: 1,
        sampler_name: info.sampler,
        scheduler: info.scheduler,
        denoise: 1,
        model: ['1', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0]
      }
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { filename_prefix: 'Filesmith', images: ['9', 0] } }
  }
}

/** Flux 2 [klein]: UNET + CLIPLoader(type=flux2, Qwen3) + flux2 VAE, FluxGuidance
 * ~4, KSampler at cfg 1 / few steps. */
export function buildFlux2Workflow(o: GenerateOptions, w: DiffusionWiring): Record<string, unknown> {
  const p = prep(o)
  const info = ARCH_INFO.flux2
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: w.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: w.clip, type: 'flux2' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: w.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: ['2', 0] } },
    '5': { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance: o.guidance ?? info.guidance } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: ['2', 0] } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width: p.width, height: p.height, batch_size: p.count } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        seed: p.seed,
        steps: o.steps > 0 ? o.steps : info.steps,
        cfg: 1,
        sampler_name: info.sampler,
        scheduler: info.scheduler,
        denoise: 1,
        model: ['1', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0]
      }
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { filename_prefix: 'Filesmith', images: ['9', 0] } }
  }
}

/** Z-Image Turbo (NextDiT/Lumina2): UNET -> ModelSamplingAuraFlow(shift 3),
 * CLIPLoader(type=lumina2, Qwen3-4B), Flux VAE, ConditioningZeroOut negative,
 * res_multistep at cfg 1 / ~8 steps. */
export function buildZImageWorkflow(o: GenerateOptions, w: DiffusionWiring): Record<string, unknown> {
  const p = prep(o)
  const info = ARCH_INFO['z-image']
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: w.unet, weight_dtype: 'default' } },
    '2': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } },
    '3': { class_type: 'CLIPLoader', inputs: { clip_name: w.clip, type: 'lumina2' } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: w.vae } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: ['3', 0] } },
    '6': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['5', 0] } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width: p.width, height: p.height, batch_size: p.count } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        seed: p.seed,
        steps: o.steps > 0 ? o.steps : info.steps,
        cfg: 1,
        sampler_name: info.sampler,
        scheduler: info.scheduler,
        denoise: 1,
        model: ['2', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0]
      }
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['4', 0] } },
    '10': { class_type: 'SaveImage', inputs: { filename_prefix: 'Filesmith', images: ['9', 0] } }
  }
}

/** Krea 2 Turbo (single-stream MMDiT): UNET + CLIPLoader(type=krea2, Qwen3-VL) +
 * Qwen-Image VAE, plain EmptyLatentImage, euler at cfg 1 / ~8 steps. */
export function buildKrea2Workflow(o: GenerateOptions, w: DiffusionWiring): Record<string, unknown> {
  const p = prep(o)
  const info = ARCH_INFO.krea2
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: w.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: w.clip, type: 'krea2' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: w.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: ['2', 0] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: ['2', 0] } },
    // Krea 2 is a Qwen-Image-lineage MMDiT on a 16-channel latent — it needs
    // EmptySD3LatentImage (16ch), NOT EmptyLatentImage (4ch, SD1.x/SDXL).
    '6': { class_type: 'EmptySD3LatentImage', inputs: { width: p.width, height: p.height, batch_size: p.count } },
    '7': {
      class_type: 'KSampler',
      inputs: {
        seed: p.seed,
        steps: o.steps > 0 ? o.steps : info.steps,
        cfg: 1,
        sampler_name: info.sampler,
        scheduler: info.scheduler,
        denoise: 1,
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['6', 0]
      }
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'Filesmith', images: ['8', 0] } }
  }
}

/** All-in-one Flux 1 checkpoint (baked CLIP + VAE) loaded via CheckpointLoaderSimple
 * — the correct path for a Flux checkpoint that lives in models/checkpoints, where
 * UNETLoader + separate encoders aren't needed. Still Flux sampling: cfg 1 with a
 * FluxGuidance node. */
export function buildFlux1CheckpointWorkflow(o: GenerateOptions): Record<string, unknown> {
  const p = prep(o)
  const info = ARCH_INFO.flux1
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: o.model } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: p.positive, clip: ['1', 1] } },
    '3': { class_type: 'FluxGuidance', inputs: { conditioning: ['2', 0], guidance: o.guidance ?? info.guidance } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: ['1', 1] } },
    '5': { class_type: 'EmptySD3LatentImage', inputs: { width: p.width, height: p.height, batch_size: p.count } },
    '6': {
      class_type: 'KSampler',
      inputs: {
        seed: p.seed,
        steps: p.steps,
        cfg: 1,
        sampler_name: info.sampler,
        scheduler: info.scheduler,
        denoise: 1,
        model: ['1', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0]
      }
    },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    '8': { class_type: 'SaveImage', inputs: { filename_prefix: 'Filesmith', images: ['7', 0] } }
  }
}

/** Dispatch to the right builder for a diffusion arch. */
export function buildDiffusionWorkflow(
  arch: GenArch,
  o: GenerateOptions,
  w: DiffusionWiring
): Record<string, unknown> {
  switch (arch) {
    case 'flux1':
      return buildFlux1Workflow(o, w)
    case 'flux2':
      return buildFlux2Workflow(o, w)
    case 'z-image':
      return buildZImageWorkflow(o, w)
    case 'krea2':
      return buildKrea2Workflow(o, w)
    default:
      throw new Error(`No diffusion workflow builder for arch ${arch}`)
  }
}
