import { describe, expect, it } from 'vitest'
import { entryFromApiWorkflow } from '../src/main/registry/userLayer'
import { instantiateWorkflow, validateEntry, workflowPlaceholders } from '../src/shared/registry'
import type { WorkflowNode } from '../src/shared/registry'

// A realistic ComfyUI "Export (API)" payload for a Flux-style diffusion model.
const exported: Record<string, WorkflowNode> = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'their-model.safetensors', weight_dtype: 'default' } },
  '2': { class_type: 'DualCLIPLoader', inputs: { clip_name1: 't5.safetensors', clip_name2: 'clip_l.safetensors', type: 'flux' } },
  '3': { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
  '4': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat they typed once', clip: ['2', 0] } },
  '5': { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance: 3.5 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry', clip: ['2', 0] } },
  '7': { class_type: 'EmptySD3LatentImage', inputs: { width: 512, height: 512, batch_size: 4 } },
  '8': {
    class_type: 'KSampler',
    inputs: {
      seed: 42,
      steps: 12,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'beta',
      denoise: 1,
      model: ['1', 0],
      positive: ['5', 0],
      negative: ['6', 0],
      latent_image: ['7', 0]
    }
  },
  '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
  '10': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['9', 0] } }
}

describe('importing a ComfyUI "Export (API)" workflow', () => {
  const { entry, notes } = entryFromApiWorkflow(exported, 'my-model', 'My Model')

  it('produces an entry the loader would accept', () => {
    expect(validateEntry(entry)).toEqual([])
    expect(entry.provenance.source).toBe('user')
  })

  it('parameterizes everything a generation must vary', () => {
    // Without this the exported prompt, seed and size would be frozen into every
    // image the user ever generates with this model.
    const ph = workflowPlaceholders(entry.workflow!)
    for (const p of ['unet', 'clip', 'clip2', 'vae', 'prompt', 'negative', 'seed', 'steps', 'width', 'height', 'batch', 'prefix'])
      expect(ph, `missing \${${p}}`).toContain(p)
  })

  it('treats the first CLIPTextEncode as positive and the second as negative', () => {
    expect(entry.workflow!.template['4'].inputs.text).toBe('${prompt}')
    expect(entry.workflow!.template['6'].inputs.text).toBe('${negative}')
  })

  it('keeps the sampler settings the graph was exported working with', () => {
    // cfg is not cosmetic: inheriting a default of 7 on a distilled model that
    // needs 1 produces garbage.
    expect(entry.sampler).toMatchObject({ name: 'euler', scheduler: 'beta', steps: 12, cfg: 1 })
    expect(entry.sampler).toMatchObject({ guidance: 3.5, hasGuidance: true })
  })

  it('records the CLIP loader + type so preflight can validate it', () => {
    expect(entry.requires?.clipLoader).toEqual({ node: 'DualCLIPLoader', type: 'flux' })
    expect(entry.requires?.nodes).toContain('KSampler')
    expect(entry.requires?.nodes).toContain('FluxGuidance')
    // Loaders are validated separately, so they're not duplicated in `nodes`.
    expect(entry.requires?.nodes).not.toContain('DualCLIPLoader')
  })

  it('leaves untouched node inputs exactly as exported', () => {
    expect(entry.workflow!.template['8'].inputs.denoise).toBe(1)
    expect(entry.workflow!.template['9'].inputs.samples).toEqual(['8', 0])
    expect(entry.workflow!.template['5'].inputs.guidance).toBe(3.5)
  })

  it('round-trips into a runnable graph', () => {
    const wf = instantiateWorkflow(entry.workflow!, {
      unet: 'u.safetensors',
      clip: 'c1',
      clip2: 'c2',
      vae: 'v',
      prompt: 'a fox',
      negative: '',
      seed: 7,
      steps: 12,
      width: 1024,
      height: 1024,
      batch: 1,
      prefix: 'Filesmith'
    })
    expect(wf['1'].inputs.unet_name).toBe('u.safetensors')
    expect(wf['8'].inputs.seed).toBe(7)
    expect(typeof wf['7'].inputs.width).toBe('number')
    expect(wf['10'].inputs.filename_prefix).toBe('Filesmith')
  })

  it('reports nothing to worry about for a complete graph', () => {
    expect(notes).toEqual([])
  })

  it('warns rather than silently guessing when the graph is incomplete', () => {
    const { notes: n } = entryFromApiWorkflow(
      { '1': { class_type: 'KSampler', inputs: { seed: 1 } } },
      'x',
      'X'
    )
    expect(n.join(' ')).toMatch(/UNETLoader or CheckpointLoaderSimple/)
    expect(n.join(' ')).toMatch(/CLIPTextEncode/)
    expect(n.join(' ')).toMatch(/SaveImage/)
  })

  it('routes an all-in-one checkpoint graph to checkpointWorkflow', () => {
    const { entry: e } = entryFromApiWorkflow(
      {
        '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
        '2': { class_type: 'CLIPTextEncode', inputs: { text: 'hi', clip: ['1', 1] } },
        '3': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['2', 0] } }
      },
      'ck',
      'Ck'
    )
    expect(e.checkpointWorkflow).toBeDefined()
    expect(e.workflow).toBeUndefined()
    expect(e.checkpointWorkflow!.template['1'].inputs.ckpt_name).toBe('${model}')
  })
})
