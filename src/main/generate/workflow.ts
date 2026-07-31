import type { GenerateOptions } from '@shared/generate'
import { GEN_MAX_COUNT, GEN_STYLES, clampDim } from '@shared/generate'
import type { DiffusionWiring, GenModel } from '@shared/genArch'
import { archInfoFor } from '@shared/genArch'
import type { WorkflowNode } from '@shared/registry'
import { instantiateWorkflow } from '@shared/registry'
import { registryEntry } from '../registry/load'

// Build the ComfyUI API-format graph for a model by filling in its registry
// workflow template. The four hand-written TypeScript graph builders (plus a
// `switch` whose `default:` threw) used to live in shared/genArch.ts, which meant
// a new architecture — or a node ComfyUI had renamed — could only be handled by
// shipping a new build. The graphs are now data; this file only substitutes
// values into them.

/** Shared prompt/seed/dimension prep, identical across arches. */
function prep(o: GenerateOptions, defaultSteps: number): Record<string, string | number> {
  const style = GEN_STYLES.find((s) => s.id === o.style)
  const positive = [o.prompt.trim(), style?.positive].filter(Boolean).join(', ')
  const negative = [o.negative.trim(), style?.negative].filter(Boolean).join(', ')
  return {
    prompt: positive,
    negative,
    seed: o.seed < 0 ? Math.floor(Math.random() * 1_000_000_000) : o.seed,
    batch: Math.max(1, Math.min(GEN_MAX_COUNT, Math.round(o.count || 1))),
    width: clampDim(o.width),
    height: clampDim(o.height),
    steps: o.steps > 0 ? o.steps : defaultSteps,
    cfg: o.cfg,
    prefix: 'Filesmith'
  }
}

/**
 * The variables a template can reference. Loader names come from the wiring the
 * preflight resolved against the live ComfyUI, never from our filesystem guess.
 */
function templateVars(
  o: GenerateOptions,
  arch: string,
  wiring?: DiffusionWiring
): Record<string, string | number> {
  const info = archInfoFor(arch)
  return {
    ...prep(o, info.steps),
    sampler: info.sampler,
    scheduler: info.scheduler,
    guidance: o.guidance ?? info.guidance,
    model: o.model,
    unet: wiring?.unet ?? '',
    clip: wiring?.clip ?? '',
    // Flux 1's DualCLIPLoader needs two names; a single-encoder wiring repeats
    // the primary rather than sending an empty string ComfyUI would reject.
    clip2: wiring?.clip2 ?? wiring?.clip ?? '',
    vae: wiring?.vae ?? ''
  }
}

/**
 * Build the graph for one model + options. Throws with a message a user can act
 * on when the registry has no workflow for this architecture (the old `default:`
 * threw "No diffusion workflow builder for arch X", which named an internal
 * concept and offered no way forward).
 */
export function buildWorkflow(
  gm: GenModel,
  o: GenerateOptions,
  wiring?: DiffusionWiring
): Record<string, WorkflowNode> {
  const entry = registryEntry(gm.arch)
  const spec = gm.source === 'checkpoint' ? entry?.checkpointWorkflow : entry?.workflow
  if (!spec)
    throw new Error(
      gm.source === 'checkpoint'
        ? `No checkpoint workflow is defined for "${gm.arch}". Add one to your registry, or pick another model.`
        : `No workflow is defined for "${gm.arch}". Add one to your registry (a ComfyUI "Save (API format)" export works), or pick another model.`
    )
  return instantiateWorkflow(spec, templateVars(o, gm.arch, wiring))
}
