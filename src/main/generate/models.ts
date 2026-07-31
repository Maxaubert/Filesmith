import { existsSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import type { ArchInfo, GenArch, GenModel, GenModelScan } from '@shared/genArch'
import { archInfoFor } from '@shared/genArch'
import type { ProbedFile } from '@shared/registry'
import type { DimCaps } from '@shared/generate'
import { scoreDetect } from '@shared/registry'
import { comfyModelsBases } from '../comfy/discover'
import { registryEntries, registryEntry } from '../registry/load'
import type { SafetensorsHeader } from './archScan'
import { classifyModelFile, inspectModelFile, readSafetensorsHeader } from './archScan'
import { resolveArch } from './archRegistry'

// The generation model list the UI shows: single-file checkpoints AND recognized
// image-generation diffusion models (Flux 1/2, Z-Image, Krea 2). Both are header-
// inspected — a Flux/SD3 checkpoint sitting in checkpoints/ is NOT blindly run as
// SDXL. Video / 3D / audio models are dropped silently; unrecognized image models
// are counted so the UI can say so instead of leaving the user guessing.

/**
 * Diffusion arches we can build a text-to-image workflow for — whatever the
 * registry has, not a hardcoded allowlist. Adding a family is now a JSON file,
 * and a user's own entry counts exactly as much as a shipped one.
 */
function supportedArches(): string[] {
  return registryEntries('generate')
    .filter((e) => e.workflow)
    .map((e) => e.id)
}

/**
 * Identify a model the built-in classifier could not place, using the `detect`
 * blocks registry entries may declare (tensor keys, metadata, byte size). Only
 * consulted where `classifyArch` gave up, so the shipped families keep exactly
 * their previous behaviour while a user- or channel-added family becomes
 * recognizable without touching the classifier.
 */
function registryArch(header: SafetensorsHeader | null, probe: ProbedFile): string | null {
  let best: string | null = null
  let bestScore = 0
  for (const e of registryEntries('generate')) {
    if (!e.detect || !e.workflow) continue
    const score = scoreDetect(e.detect, {
      ...probe,
      metaArch: header?.metadata['modelspec.architecture'] ?? header?.metadata['architecture'],
      tensorKeys: header?.keys
    })
    if (score > bestScore) {
      bestScore = score
      best = e.id
    }
  }
  return best
}

/** Picker heading for an arch: the registry's own group, so a user-added family
 * gets its own heading instead of being filed under a built-in's. */
function archGroup(id: string): string {
  return registryEntry(id)?.group ?? archInfoFor(id).group
}

function label(name: string): string {
  return basename(name).replace(/\.[^.]+$/, '')
}

function fileSize(p: string): number {
  try {
    return statSync(p).size
  } catch {
    return 0
  }
}

/** Recursively list model files (ComfyUI-relative name + abs path + models base)
 * under a given subdir across every ComfyUI base, de-duped by relative name. */
function walkModels(subdirs: string[], exts: RegExp): { rel: string; abs: string; base: string }[] {
  const out: { rel: string; abs: string; base: string }[] = []
  const seen = new Set<string>()
  const walk = (dir: string, rel: string, base: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      const r = rel ? `${rel}/${e}` : e
      if (st.isDirectory()) walk(p, r, base)
      else if (exts.test(e) && !seen.has(r.toLowerCase())) {
        seen.add(r.toLowerCase())
        out.push({ rel: r, abs: p, base })
      }
    }
  }
  for (const base of comfyModelsBases())
    for (const sub of subdirs) {
      const dir = join(base, sub)
      if (existsSync(dir)) walk(dir, '', base)
    }
  return out
}

/** Scan every generation model, with counts for what we saw but can't offer. */
export function scanGenerationModels(): GenModelScan {
  const models: GenModel[] = []
  let excluded = 0
  let unrecognized = 0
  let gguf = 0

  // --- Single-file checkpoints (CheckpointLoaderSimple) --------------------
  for (const { rel, abs, base } of walkModels(['checkpoints'], /\.(safetensors|ckpt|sft)$/i)) {
    const common = { name: rel, label: label(rel), group: '', source: 'checkpoint' as const, baseDir: base }
    // .ckpt is a pickle we can't header-inspect; trust CheckpointLoaderSimple with
    // the SDXL graph (the overwhelmingly common case for a .ckpt checkpoint).
    const header = /\.(safetensors|sft)$/i.test(rel) ? readSafetensorsHeader(abs) : null
    const arch = header ? classifyModelFile(abs) : 'sdxl'
    if (arch === 'sdxl' || (!header && /\.ckpt$/i.test(rel))) {
      models.push({ ...common, arch: 'sdxl', group: archGroup('sdxl'), runnable: true })
    } else if (arch === 'flux1') {
      // All-in-one Flux checkpoint: baked CLIP+VAE, loaded via CheckpointLoaderSimple.
      models.push({ ...common, arch: 'flux1', group: archGroup('flux1'), runnable: true })
    } else {
      // SD3 / Flux 2 / an unrecognized single-file checkpoint: don't pretend it's SDXL.
      models.push({
        ...common,
        arch: 'sdxl',
        group: archGroup('sdxl'),
        runnable: false,
        detectedArch: arch,
        // A single-file checkpoint always has SOMETHING to try: ComfyUI's
        // CheckpointLoaderSimple graph. Worst case the user learns why not.
        tryAnyway: true,
        reason:
          arch === 'sd3'
            ? 'SD3 checkpoints are not supported yet.'
            : 'Unrecognized checkpoint — may not be a standard SDXL model.'
      })
    }
  }

  // --- Bare diffusion models (UNETLoader + separate encoders/VAE) ----------
  for (const { rel, abs, base } of walkModels(['diffusion_models', 'unet'], /\.(safetensors|sft|gguf)$/i)) {
    if (/\.gguf$/i.test(rel)) {
      gguf += 1
      continue
    }
    const inspected = inspectModelFile(abs)
    const isExcluded = inspected.excluded
    // Registry-declared detection only fills the gap the classifier left, so the
    // shipped families behave exactly as before.
    const arch =
      inspected.arch !== 'unknown'
        ? (inspected.arch as string)
        : (registryArch(inspected.header, { basename: basename(rel), sizeBytes: fileSize(abs) }) ??
          'unknown')
    // Nothing on disk is invisible. Both of these used to `continue`, so a user
    // with a folder full of next month's architecture saw "No image models
    // found" and had no way to tell whether the app had even seen the files.
    // They are listed, named, and marked why they can't run.
    if (isExcluded) {
      excluded += 1
      models.push({
        name: rel,
        label: label(rel),
        arch: 'sdxl',
        group: 'Not image models',
        source: 'diffusion',
        runnable: false,
        baseDir: base,
        detectedArch: arch,
        notImage: true,
        // Advisory, not terminal. The exclusion keys on `patch_embedding` +
        // `time_embedding`, which are generic DiT names — a real text-to-image
        // model can trip them. Say so and let the user decide.
        tryAnyway: true,
        reason: 'Looks like a video/3D/audio model, not a text-to-image one.'
      })
      continue
    }
    if (!supportedArches().includes(arch)) {
      unrecognized += 1
      models.push({
        name: rel,
        label: label(rel),
        arch: 'sdxl',
        group: 'Unrecognized',
        source: 'diffusion',
        runnable: false,
        baseDir: base,
        detectedArch: arch,
        tryAnyway: true,
        reason:
          arch === 'unknown'
            ? "Filesmith doesn't recognize this architecture yet."
            : `Detected as ${arch}, which Filesmith can't build a workflow for yet.`
      })
      continue
    }
    const ga = arch as GenArch
    const { missing, wiring } = resolveArch(ga, rel, fileSize(abs))
    const common = { name: rel, label: label(rel), arch: ga, group: archGroup(ga), source: 'diffusion' as const, baseDir: base }
    if (!missing.length && wiring) {
      models.push({ ...common, runnable: true, wiring })
    } else {
      models.push({
        ...common,
        runnable: false,
        reason: `Needs ${missing.map((m) => m.label).join(', ')}`,
        missing: missing.map((m) => ({
          label: m.label,
          filename: m.download.filename,
          url: m.download.url,
          urls: m.download.urls,
          sha256: m.download.sha256,
          approxSize: m.download.approxSize,
          subdir: m.download.subdir
        }))
      })
    }
  }

  models.sort(
    (a, b) => Number(b.runnable) - Number(a.runnable) || a.group.localeCompare(b.group) || a.label.localeCompare(b.label)
  )
  return { models, excluded, unrecognized, gguf }
}

/**
 * Sampler/group settings for every arch the registry knows, for the renderer.
 * Without this the UI would fall back to a compiled-in table, so a user-added
 * family would generate with someone else's sampler defaults (and cfg 7 on a
 * distilled model produces garbage). Data in, data out.
 */
export function registryArchInfo(): Record<string, ArchInfo> {
  const out: Record<string, ArchInfo> = {}
  for (const e of registryEntries('generate')) {
    if (!e.sampler) continue
    out[e.id] = {
      group: e.group ?? e.label,
      sampler: e.sampler.name,
      scheduler: e.sampler.scheduler,
      steps: e.sampler.steps,
      cfg: e.sampler.cfg,
      guidance: e.sampler.guidance,
      hasGuidance: e.sampler.hasGuidance,
      minComfyNote: e.requires?.minComfyNote
    }
  }
  return out
}

/** Per-arch dimension limits, for the renderer's custom width/height inputs. */
export function registryDimCaps(): Record<string, DimCaps> {
  const out: Record<string, DimCaps> = {}
  for (const e of registryEntries('generate')) {
    const c = e.capabilities
    if (c) out[e.id] = { minDim: c.minDim, maxDim: c.maxDim, dimStep: c.dimStep }
  }
  return out
}

/** Just the model list (for the generate path's lookup). */
export function findGenerationModels(): GenModel[] {
  return scanGenerationModels().models
}

/** Look up a single model by its ComfyUI name (for the generate path). */
export function findGenerationModel(name: string): GenModel | undefined {
  return findGenerationModels().find((m) => m.name === name)
}

/**
 * The ComfyUI `models` directory to download a model's companion files into: the
 * base that model actually lives under (so encoders/VAEs land beside it and the
 * SAME ComfyUI sees them), falling back to the first base with a models tree.
 */
export function primaryModelsDir(preferBase?: string): string | null {
  if (preferBase && existsSync(preferBase)) return preferBase
  const bases = comfyModelsBases()
  for (const base of bases)
    if (existsSync(join(base, 'checkpoints')) || existsSync(join(base, 'diffusion_models'))) return base
  for (const base of bases) if (existsSync(base)) return base
  return null
}
