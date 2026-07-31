import type { GenerateOptions } from '@shared/generate'
import type { DimCaps } from '@shared/generate'
import { GEN_MAX_COUNT, GEN_STYLES, clampDim } from '@shared/generate'
import type { DiffusionWiring, GenModel } from '@shared/genArch'
import { archInfoFor } from '@shared/genArch'
import type { WorkflowNode, WorkflowSpec } from '@shared/registry'
import { instantiateWorkflow } from '@shared/registry'
import { registryEntry } from '../registry/load'

// Build the ComfyUI API-format graph for a model by filling in its registry
// workflow template. The four hand-written TypeScript graph builders (plus a
// `switch` whose `default:` threw) used to live in shared/genArch.ts, which meant
// a new architecture — or a node ComfyUI had renamed — could only be handled by
// shipping a new build. The graphs are now data; this file only substitutes
// values into them.

/** Shared prompt/seed/dimension prep, identical across arches. */
function prep(
  o: GenerateOptions,
  defaultSteps: number,
  caps?: DimCaps
): Record<string, string | number> {
  const style = GEN_STYLES.find((s) => s.id === o.style)
  const positive = [o.prompt.trim(), style?.positive].filter(Boolean).join(', ')
  const negative = [o.negative.trim(), style?.negative].filter(Boolean).join(', ')
  return {
    prompt: positive,
    negative,
    seed: o.seed < 0 ? Math.floor(Math.random() * 1_000_000_000) : o.seed,
    batch: Math.max(1, Math.min(GEN_MAX_COUNT, Math.round(o.count || 1))),
    width: clampDim(o.width, caps),
    height: clampDim(o.height, caps),
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
  const caps = registryEntry(arch)?.capabilities
  return {
    ...prep(o, info.steps, caps),
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
 * The fallback graph for a model we can't place: ComfyUI's own most standard
 * chain. A single-file checkpoint goes through CheckpointLoaderSimple (which
 * carries its own CLIP and VAE); a bare diffusion model uses UNETLoader with
 * whatever encoders/VAE were resolved. Neither is guaranteed to work — that is
 * the point of calling it "try anyway" — but ComfyUI's error is far more useful
 * to the user than our refusal to attempt anything.
 */
function genericWorkflow(gm: GenModel): WorkflowSpec {
  const sampler = (model: [string, number], pos: string, neg: string, latent: string): WorkflowNode => ({
    class_type: 'KSampler',
    inputs: {
      seed: '${seed}',
      steps: '${steps}',
      cfg: '${cfg}',
      sampler_name: '${sampler}',
      scheduler: '${scheduler}',
      denoise: 1,
      model,
      positive: [pos, 0],
      negative: [neg, 0],
      latent_image: [latent, 0]
    }
  })
  if (gm.source === 'checkpoint')
    return {
      format: 'comfy-api-v1',
      template: {
        '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '${model}' } },
        '2': { class_type: 'CLIPTextEncode', inputs: { text: '${prompt}', clip: ['1', 1] } },
        '3': { class_type: 'CLIPTextEncode', inputs: { text: '${negative}', clip: ['1', 1] } },
        '4': {
          class_type: 'EmptyLatentImage',
          inputs: { width: '${width}', height: '${height}', batch_size: '${batch}' }
        },
        '5': sampler(['1', 0], '2', '3', '4'),
        '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
        '7': { class_type: 'SaveImage', inputs: { filename_prefix: '${prefix}', images: ['6', 0] } }
      }
    }
  return {
    format: 'comfy-api-v1',
    template: {
      '1': { class_type: 'UNETLoader', inputs: { unet_name: '${unet}', weight_dtype: 'default' } },
      '2': { class_type: 'CLIPLoader', inputs: { clip_name: '${clip}', type: 'stable_diffusion' } },
      '3': { class_type: 'VAELoader', inputs: { vae_name: '${vae}' } },
      '4': { class_type: 'CLIPTextEncode', inputs: { text: '${prompt}', clip: ['2', 0] } },
      '5': { class_type: 'CLIPTextEncode', inputs: { text: '${negative}', clip: ['2', 0] } },
      '6': {
        class_type: 'EmptySD3LatentImage',
        inputs: { width: '${width}', height: '${height}', batch_size: '${batch}' }
      },
      '7': sampler(['1', 0], '4', '5', '6'),
      '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: '${prefix}', images: ['8', 0] } }
    }
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
  wiring?: DiffusionWiring,
  tryAnyway = false
): Record<string, WorkflowNode> {
  const entry = registryEntry(gm.arch)
  let spec = gm.source === 'checkpoint' ? entry?.checkpointWorkflow : entry?.workflow
  // "Try anyway": no known workflow, so send the generic one and let ComfyUI
  // give its own verdict. The user learns something either way — which beats a
  // model that is simply invisible or refused with no route forward.
  if (!spec && tryAnyway) spec = genericWorkflow(gm)
  if (!spec)
    throw new Error(
      gm.source === 'checkpoint'
        ? `No checkpoint workflow is defined for "${gm.arch}". Add one to your registry, or pick another model.`
        : `No workflow is defined for "${gm.arch}". Add one to your registry (a ComfyUI "Save (API format)" export works), or pick another model.`
    )
  return instantiateWorkflow(spec, templateVars(o, gm.arch, wiring))
}
