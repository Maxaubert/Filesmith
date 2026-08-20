import { closeSync, openSync, readSync, statSync } from 'fs'

// Identify a diffusion model's architecture by reading ONLY the safetensors
// header (an 8-byte little-endian length + that many bytes of JSON listing every
// tensor name), never the multi-GB weights. Architecture is inferred from the
// tensor-key signatures each family uses — far more reliable than filename
// guessing, which the user has (rightly) pushed back on before.

export interface SafetensorsHeader {
  /** Tensor names (excludes the __metadata__ entry). */
  keys: string[]
  /** The __metadata__ object, if present (e.g. modelspec.architecture). */
  metadata: Record<string, string>
}

// Safetensors headers are small (a few hundred KB even for Flux), but cap the
// read so a corrupt/hostile length field can't make us allocate gigabytes.
const MAX_HEADER_BYTES = 16 * 1024 * 1024

/** Read a safetensors file's header. Returns null on any read/parse failure. */
export function readSafetensorsHeader(path: string): SafetensorsHeader | null {
  let fd: number | null = null
  try {
    const size = statSync(path).size
    if (size < 8) return null
    fd = openSync(path, 'r')
    const lenBuf = Buffer.allocUnsafe(8)
    if (readSync(fd, lenBuf, 0, 8, 0) < 8) return null
    const headerLen = Number(lenBuf.readBigUInt64LE(0))
    if (!Number.isSafeInteger(headerLen) || headerLen <= 0 || headerLen > MAX_HEADER_BYTES)
      return null
    if (8 + headerLen > size) return null
    const json = Buffer.allocUnsafe(headerLen)
    let read = 0
    while (read < headerLen) {
      const n = readSync(fd, json, read, headerLen - read, 8 + read)
      if (n <= 0) break
      read += n
    }
    if (read < headerLen) return null
    const parsed = JSON.parse(json.toString('utf-8')) as Record<string, unknown>
    const metadata = (parsed.__metadata__ as Record<string, string>) ?? {}
    const keys = Object.keys(parsed).filter((k) => k !== '__metadata__')
    return { keys, metadata }
  } catch {
    return null
  } finally {
    if (fd != null) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

export type DiffusionArch = 'flux1' | 'flux2' | 'z-image' | 'krea2' | 'sd3' | 'sdxl' | 'unknown'

/**
 * Classify architecture from a header's tensor keys. Order matters: Flux 2 is
 * checked before Flux 1 because it also has double/single_blocks but adds the
 * `*_stream_modulation_*` keys that Flux 1 lacks.
 */
/** Substrings in modelspec.architecture that mark a NON-image model we must never
 * run through an image workflow (video / 3D / audio families), plus Lumina, whose
 * NextDiT keys collide with Z-Image but which uses a different (Gemma) encoder. */
const NON_IMAGE_META =
  /video|wan|hunyuan.?video|mochi|cogvideo|ltx|framepack|animate|3d|hunyuan3d|trellis|triposg|audio|lumina/i

/** Read the declared architecture from metadata (the most reliable signal, when
 * present). Empty string if absent. */
function metaArch(h: SafetensorsHeader): string {
  return (h.metadata['modelspec.architecture'] || h.metadata['architecture'] || '').toLowerCase()
}

export function classifyArch(h: SafetensorsHeader): DiffusionArch {
  const has = (sub: string): boolean => h.keys.some((k) => k.includes(sub))
  const fluxLike = has('double_blocks') || has('single_blocks')

  // Metadata is the most reliable disambiguator when present: reject declared
  // non-image families outright, even if their tensor keys look image-like.
  if (NON_IMAGE_META.test(metaArch(h))) return 'unknown'

  // Reject non-image DiTs that REUSE Flux's block names, before the Flux checks —
  // otherwise a video/3D model loads through the Flux path and renders noise.
  // HunyuanVideo adds a text token-refiner; FramePack a clean-image embedder; Wan
  // uses a video patch-embedding; the Hunyuan3D shape DiT has the blocks but no
  // text/image input projections at all.
  if (isExcludedNonImage(h)) return 'unknown'
  if (fluxLike && !(has('img_in') && has('txt_in'))) return 'unknown' // e.g. Hunyuan3D

  // Genuine Flux: dual + single stream blocks WITH the image + text projections.
  if (fluxLike && has('stream_modulation')) return 'flux2' // Flux 2 (klein/pro)
  if (fluxLike) return 'flux1' // Flux 1 (dev/schnell/krea-dev/kontext)

  // SD3 / SD3.5: MMDiT joint blocks.
  if (has('joint_blocks')) return 'sd3'
  // Krea 2 (single-stream MMDiT): distinctive TextFusion (txtfusion) module.
  if (has('txtfusion') || (has('tmlp') && has('tproj'))) return 'krea2'
  // Z-Image / Lumina-style NextDiT: caption embedder + refiner stacks.
  if (has('cap_embedder') || (has('noise_refiner') && has('context_refiner'))) return 'z-image'
  // Classic UNet (SDXL/SD1.5) if it somehow lands in diffusion_models.
  if (!fluxLike && (has('input_blocks') || has('middle_block'))) return 'sdxl'
  return 'unknown'
}

/**
 * A positively-identified NON-image model (video / 3D / audio) that must be kept
 * out of the image generator entirely — as opposed to a merely unrecognized model
 * (which the UI can surface as "unrecognized"). Uses both metadata and the tensor
 * tells that distinguish these families from a real text-to-image DiT.
 */
export function isExcludedNonImage(h: SafetensorsHeader): boolean {
  const has = (sub: string): boolean => h.keys.some((k) => k.includes(sub))
  if (NON_IMAGE_META.test(metaArch(h))) return true
  // HunyuanVideo (token refiner), FramePack (clean-image embedder), Wan (VACE).
  if (has('individual_token_refiner') || has('clean_x_embedder') || has('vace_blocks')) return true
  // Wan-style video DiT: 3D patch-embedding + temporal embedding, no Flux blocks.
  if (has('patch_embedding') && (has('time_embedding') || has('temporal')) && !has('double_blocks'))
    return true
  // Audio / vocoder stacks (LTX and similar bundle these).
  if (has('vocoder') || has('audio_vae')) return true
  // Flux-style blocks but no text+image projections = a 3D/other shape DiT.
  if ((has('double_blocks') || has('single_blocks')) && !(has('img_in') && has('txt_in')))
    return true
  return false
}

/** True when the file bundles its own text encoders + VAE (an all-in-one
 * checkpoint), meaning UNETLoader reads only the diffusion weights and the
 * baked encoders/VAE are ignored — we still supply encoders/VAE separately. */
export function isAllInOne(h: SafetensorsHeader): boolean {
  return (
    h.keys.some((k) => k.startsWith('text_encoders.')) && h.keys.some((k) => k.startsWith('vae.'))
  )
}

/** classifyModelFile + the excluded/unrecognized distinction in one header read.
 * The header comes back too, so a caller that wants to try registry-declared
 * detection on an unrecognized file doesn't pay for a second read. */
export function inspectModelFile(path: string): {
  arch: DiffusionArch
  excluded: boolean
  header: SafetensorsHeader | null
} {
  const h = readSafetensorsHeader(path)
  if (!h) return { arch: 'unknown', excluded: false, header: null }
  return { arch: classifyArch(h), excluded: isExcludedNonImage(h), header: h }
}

/** Convenience: classify straight from a path (null header -> 'unknown'). */
export function classifyModelFile(path: string): DiffusionArch {
  const h = readSafetensorsHeader(path)
  return h ? classifyArch(h) : 'unknown'
}
