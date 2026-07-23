import { existsSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import type { GenArch, GenModel, GenModelScan } from '@shared/genArch'
import { ARCH_INFO } from '@shared/genArch'
import { comfyModelsBases } from '../comfy/discover'
import { classifyModelFile, inspectModelFile, readSafetensorsHeader } from './archScan'
import { resolveArch } from './archRegistry'

// The generation model list the UI shows: single-file checkpoints AND recognized
// image-generation diffusion models (Flux 1/2, Z-Image, Krea 2). Both are header-
// inspected — a Flux/SD3 checkpoint sitting in checkpoints/ is NOT blindly run as
// SDXL. Video / 3D / audio models are dropped silently; unrecognized image models
// are counted so the UI can say so instead of leaving the user guessing.

/** Diffusion arches we can build a text-to-image workflow for. */
const SUPPORTED: GenArch[] = ['flux1', 'flux2', 'z-image', 'krea2']

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
      models.push({ ...common, arch: 'sdxl', group: ARCH_INFO.sdxl.group, runnable: true })
    } else if (arch === 'flux1') {
      // All-in-one Flux checkpoint: baked CLIP+VAE, loaded via CheckpointLoaderSimple.
      models.push({ ...common, arch: 'flux1', group: ARCH_INFO.flux1.group, runnable: true })
    } else {
      // SD3 / Flux 2 / an unrecognized single-file checkpoint: don't pretend it's SDXL.
      models.push({
        ...common,
        arch: 'sdxl',
        group: ARCH_INFO.sdxl.group,
        runnable: false,
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
    const { arch, excluded: isExcluded } = inspectModelFile(abs)
    if (isExcluded) {
      excluded += 1
      continue // video / 3D / audio — never an image model
    }
    if (!SUPPORTED.includes(arch as GenArch)) {
      unrecognized += 1
      continue
    }
    const ga = arch as GenArch
    const { missing, wiring } = resolveArch(ga, rel, fileSize(abs))
    const common = { name: rel, label: label(rel), arch: ga, group: ARCH_INFO[ga].group, source: 'diffusion' as const, baseDir: base }
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
