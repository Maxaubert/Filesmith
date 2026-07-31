// Multi-architecture ComfyUI text-to-image workflow builders. Each modern
// diffusion family (Flux 1/2, Z-Image, Krea 2) loads through its own node chain
// and demands specific sampler settings (cfg MUST be 1 for all of these — real
// guidance lives in FluxGuidance or is baked into the turbo distillation). The
// graphs here are the canonical API-format templates, verified against ComfyUI
// docs/examples. SDXL's single-file-checkpoint graph stays in generate.ts.

/**
 * A generation architecture id — the `id` of a `kind: 'generate'` registry entry.
 *
 * Deliberately a plain string, not a closed union. The union was the single
 * biggest reason a new checkpoint family needed an app release: it appeared in
 * six places in compiled code, and a model that was not in it could not even be
 * listed. The built-ins are 'sdxl' | 'flux1' | 'flux2' | 'z-image' | 'krea2';
 * anything the registry defines is equally valid.
 */
export type GenArch = string

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

/** Sampler defaults for the built-in arches. The registry is the source of
 * truth at runtime (see generate:status.archInfo); this table is the offline
 * fallback and is asserted against the shipped pack by a test, so the two
 * cannot drift. */
export const ARCH_INFO: Record<string, ArchInfo> = {
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
  /** Primary source (urls[0]) — kept for display. */
  url: string
  /** Every mirror, tried in order: a pinned commit first, a moving branch last,
   * so a repo reorg degrades to a fallback instead of 404ing the model out of
   * existence. */
  urls?: string[]
  /** Declared checksum, verified while streaming. */
  sha256?: string
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
  /** Not runnable through a known workflow, but a generic graph CAN be sent to
   * ComfyUI. The user gets a "Try anyway" action and ComfyUI's own error if it
   * fails — the app's job is to make the good path obvious, not to make the
   * unusual path impossible. */
  tryAnyway?: boolean
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
  /** Sampler defaults per arch, straight from the registry — so a user-added
   * family gets ITS defaults in the UI, not a compiled-in guess. */
  archInfo?: Record<string, ArchInfo>
  /** Registry problems worth telling the user about (a malformed user entry). */
  registryWarnings?: string[]
  /** Per-arch dimension limits from the registry, replacing one global clamp. */
  dimCaps?: Record<string, { minDim?: number; maxDim?: number; dimStep?: number }>
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

/** Sampler defaults for any arch, with a safe fallback so an architecture the
 * registry knows about (or one we've never heard of) never crashes the UI. */
export const DEFAULT_ARCH_INFO: ArchInfo = {
  group: 'Other',
  sampler: 'euler',
  scheduler: 'normal',
  steps: 20,
  cfg: 7,
  guidance: 0,
  hasGuidance: false
}

/** ARCH_INFO[arch] with a guaranteed result. Prefer the registry-supplied table
 * from generate:status when you have it; this is the offline fallback. */
export function archInfoFor(arch: GenArch, table?: Record<string, ArchInfo>): ArchInfo {
  return table?.[arch] ?? ARCH_INFO[arch] ?? DEFAULT_ARCH_INFO
}
