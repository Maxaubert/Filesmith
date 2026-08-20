import { describe, expect, it } from 'vitest'
import {
  KNOWN_PLACEHOLDERS,
  instantiateWorkflow,
  mergeRegistry,
  nameMatches,
  scoreDetect,
  selectCompanions,
  validateEntry,
  workflowPlaceholders,
  type RegistryEntry,
  type RegistryFile
} from '../src/shared/registry'
import { ARCH_INFO, archInfoFor, DEFAULT_ARCH_INFO } from '../src/shared/genArch'
import { loadRegistry, registryEntries, registryEntry } from '../src/main/registry/load'

const entry = (over: Partial<RegistryEntry>): RegistryEntry => ({
  id: 'x',
  kind: 'generate',
  label: 'X',
  provenance: { source: 'builtin' },
  ...over
})

describe('the shipped registry pack', () => {
  it('loads with no warnings', () => {
    expect(loadRegistry().warnings).toEqual([])
  })

  it('covers every architecture that used to be a compile-time union member', () => {
    // The GenArch union, the SUPPORTED allowlist, ARCH_INFO, the workflow
    // builders, CLIP_REQ and EXTRA_NODES were six separate hardcoded lists. If
    // the pack ever stops covering one of them, that arch silently disappears
    // from the app — so assert the coverage rather than trusting it.
    const ids = registryEntries('generate').map((e) => e.id)
    for (const a of ['sdxl', 'flux1', 'flux2', 'z-image', 'krea2']) expect(ids).toContain(a)
  })

  it('validates every shipped entry (subdirs, filenames, https, placeholders)', () => {
    for (const e of registryEntries('generate')) expect(validateEntry(e)).toEqual([])
  })

  it('matches the compiled ARCH_INFO fallback exactly, so the two cannot drift', () => {
    for (const [arch, info] of Object.entries(ARCH_INFO)) {
      const e = registryEntry(arch)
      expect(e, `registry is missing ${arch}`).toBeDefined()
      expect(e!.sampler).toBeDefined()
      expect({
        sampler: e!.sampler!.name,
        scheduler: e!.sampler!.scheduler,
        steps: e!.sampler!.steps,
        cfg: e!.sampler!.cfg,
        guidance: e!.sampler!.guidance,
        hasGuidance: e!.sampler!.hasGuidance,
        group: e!.group,
        minComfyNote: e!.requires?.minComfyNote
      }).toEqual({
        sampler: info.sampler,
        scheduler: info.scheduler,
        steps: info.steps,
        cfg: info.cfg,
        guidance: info.guidance,
        hasGuidance: info.hasGuidance,
        group: info.group,
        minComfyNote: info.minComfyNote
      })
    }
  })

  it('only uses placeholders the app knows how to supply', () => {
    for (const e of registryEntries('generate'))
      for (const wf of [e.workflow, e.checkpointWorkflow]) {
        if (!wf) continue
        for (const p of workflowPlaceholders(wf)) expect(KNOWN_PLACEHOLDERS).toContain(p)
      }
  })

  it('every diffusion arch declares its CLIP loader + type, which preflight needs', () => {
    for (const e of registryEntries('generate')) {
      if (!e.workflow) continue // checkpoint-only (sdxl)
      expect(e.requires?.clipLoader, `${e.id} has no clipLoader`).toBeDefined()
      expect(e.requires?.nodes?.length).toBeGreaterThan(0)
    }
  })

  it('carries a real sha256 and an immutable pinned URL for every download', () => {
    // The hashes are Hugging Face git-LFS object ids, which ARE the content
    // sha256 — fetched by scripts/registry-hashes.mjs, never invented. Pinning
    // matters as much: a `resolve/main` primary points at a moving branch, so a
    // baked-in hash would eventually fail for everyone.
    for (const e of registryEntries('generate')) {
      const all = [...(e.companions ?? []), ...(e.companionSets ?? []).flatMap((s) => s.companions)]
      for (const c of all) {
        expect(c.download.sha256, `${e.id}/${c.label} has no hash`).toMatch(/^[0-9a-f]{64}$/)
        expect(c.download.urls[0], `${e.id}/${c.label} primary is not pinned`).toMatch(
          /\/resolve\/[0-9a-f]{40}\//
        )
        // The branch URL survives as a fallback for the day the pin disappears.
        expect(c.download.urls.length).toBeGreaterThan(1)
        expect(c.download.urls[c.download.urls.length - 1]).toMatch(/\/resolve\/main\//)
        expect(c.download.bytes ?? 0).toBeGreaterThan(0)
      }
    }
  })

  it('ships the same companion filenames the hardcoded table had', () => {
    const files = (id: string, size?: number): string[] =>
      selectCompanions(registryEntry(id)!, 'm.safetensors', size).map((c) => c.download.filename)
    expect(files('flux1').sort()).toEqual(
      ['ae.safetensors', 'clip_l.safetensors', 't5xxl_fp8_e4m3fn_scaled.safetensors'].sort()
    )
    expect(files('z-image')).toContain('qwen_3_4b.safetensors')
    expect(files('z-image')).toContain('ae.safetensors')
    expect(files('krea2')).toContain('qwen3vl_4b_fp8_scaled.safetensors')
    expect(files('krea2')).toContain('qwen_image_vae.safetensors')
  })
})

describe('mergeRegistry', () => {
  it('merges per id, per FIELD — a user entry can override one field only', () => {
    const builtin: RegistryFile = {
      schemaVersion: 1,
      entries: [entry({ id: 'flux2', label: 'Flux 2', group: 'Flux 2', companions: [] })]
    }
    const user: RegistryFile = {
      schemaVersion: 1,
      entries: [{ id: 'flux2', provenance: { source: 'user' } } as RegistryEntry]
    }
    const [merged] = mergeRegistry([builtin, user])
    expect(merged.label).toBe('Flux 2') // inherited
    expect(merged.group).toBe('Flux 2') // inherited
    expect(merged.provenance.source).toBe('user') // overridden
  })

  it('keeps first-seen order and appends genuinely new entries', () => {
    const a: RegistryFile = { schemaVersion: 1, entries: [entry({ id: 'a' }), entry({ id: 'b' })] }
    const b: RegistryFile = { schemaVersion: 1, entries: [entry({ id: 'c' }), entry({ id: 'a' })] }
    expect(mergeRegistry([a, b]).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('validateEntry (the path-traversal and https gate)', () => {
  const withCompanion = (over: Record<string, unknown>): RegistryEntry =>
    entry({
      companions: [
        {
          role: 'vae',
          label: 'v',
          subdir: 'vae',
          identify: {},
          download: { filename: 'ok.safetensors', approxSize: '1 MB', urls: ['https://h/x'] },
          ...over
        } as never
      ]
    })

  it('rejects a filename with a separator or ..', () => {
    for (const bad of ['../../evil.exe', 'sub/dir.safetensors', '..', 'a\\b'])
      expect(
        validateEntry(
          withCompanion({ download: { filename: bad, approxSize: '1 MB', urls: ['https://h/x'] } })
        )
      ).not.toEqual([])
  })

  it('rejects a subdir outside the fixed enum', () => {
    expect(validateEntry(withCompanion({ subdir: 'custom_nodes' }))).not.toEqual([])
    expect(validateEntry(withCompanion({ subdir: '../..' }))).not.toEqual([])
  })

  it('rejects a non-https download URL', () => {
    for (const u of ['http://h/x', 'file:///C:/x', 'javascript:alert(1)'])
      expect(
        validateEntry(
          withCompanion({ download: { filename: 'a.safetensors', approxSize: '1 MB', urls: [u] } })
        )
      ).not.toEqual([])
  })

  it('rejects a workflow placeholder the app cannot supply', () => {
    const e = entry({
      workflow: {
        format: 'comfy-api-v1',
        template: { '1': { class_type: 'X', inputs: { a: '${notAThing}' } } }
      }
    })
    expect(validateEntry(e).join()).toMatch(/unknown placeholder/)
  })

  it('accepts a well-formed entry', () => {
    expect(validateEntry(withCompanion({}))).toEqual([])
  })
})

describe('instantiateWorkflow', () => {
  const spec = {
    format: 'comfy-api-v1' as const,
    template: {
      '1': { class_type: 'UNETLoader', inputs: { unet_name: '${unet}', weight_dtype: 'default' } },
      '2': {
        class_type: 'KSampler',
        inputs: { seed: '${seed}', steps: '${steps}', cfg: 1, model: ['1', 0] }
      }
    }
  }

  it('substitutes a whole-string placeholder as the RAW value, keeping numbers numeric', () => {
    // ComfyUI rejects a string where it wants an int, so "${seed}" must not
    // become "123".
    const wf = instantiateWorkflow(spec, { unet: 'a.safetensors', seed: 123, steps: 8 })
    expect(wf['2'].inputs.seed).toBe(123)
    expect(wf['2'].inputs.steps).toBe(8)
    expect(typeof wf['2'].inputs.seed).toBe('number')
  })

  it('leaves literals and node links untouched', () => {
    const wf = instantiateWorkflow(spec, { unet: 'a', seed: 1, steps: 2 })
    expect(wf['1'].inputs.weight_dtype).toBe('default')
    expect(wf['2'].inputs.cfg).toBe(1)
    expect(wf['2'].inputs.model).toEqual(['1', 0])
  })

  it('leaves an unknown placeholder alone instead of writing "undefined"', () => {
    const wf = instantiateWorkflow(spec, { seed: 1, steps: 2 })
    expect(wf['1'].inputs.unet_name).toBe('${unet}')
  })

  it('interpolates inside a longer string', () => {
    const s = {
      format: 'comfy-api-v1' as const,
      template: { '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'x-${prefix}-y' } } }
    }
    expect(instantiateWorkflow(s, { prefix: 'Filesmith' })['1'].inputs.filename_prefix).toBe(
      'x-Filesmith-y'
    )
  })
})

describe('scoreDetect (content beats the filename, always)', () => {
  it('requires every `all` tensor key and rejects any `none` key', () => {
    const d = { tensorKeys: { all: ['double_blocks'], none: ['vace_blocks'] } }
    expect(scoreDetect(d, { basename: 'm', tensorKeys: ['x.double_blocks.0'] })).toBeGreaterThan(0)
    expect(scoreDetect(d, { basename: 'm', tensorKeys: ['x.single_blocks.0'] })).toBe(0)
    expect(
      scoreDetect(d, { basename: 'm', tensorKeys: ['x.double_blocks.0', 'vace_blocks.1'] })
    ).toBe(0)
  })

  it('scores tensor evidence far above a filename hint', () => {
    const byKeys = scoreDetect(
      { tensorKeys: { all: ['cap_embedder'] } },
      { basename: 'unrelated.safetensors', tensorKeys: ['cap_embedder.0'] }
    )
    const byName = scoreDetect({ nameHint: 'z.?image' }, { basename: 'z-image.safetensors' })
    expect(byKeys).toBeGreaterThan(byName * 10)
  })

  it('rejects a file outside a declared size range but tolerates an unknown size', () => {
    const d = { sizeBytesRange: [1000, 2000] as [number, number] }
    expect(scoreDetect(d, { basename: 'm', sizeBytes: 1500 })).toBeGreaterThan(0)
    expect(scoreDetect(d, { basename: 'm', sizeBytes: 5000 })).toBe(0)
    expect(scoreDetect(d, { basename: 'm' })).toBe(0) // no other evidence => 0
  })

  it('matches an ncnn .param basename exactly', () => {
    const d = { ncnnParamBasename: 'realesrgan-x4plus' }
    expect(scoreDetect(d, { basename: 'realesrgan-x4plus.param' })).toBeGreaterThan(0)
    expect(scoreDetect(d, { basename: 'realesrgan-x4plus-anime.param' })).toBe(0)
  })
})

describe('nameMatches (companion identification on disk)', () => {
  it('keeps the exact patterns the hardcoded table used', () => {
    const ae = registryEntry('flux1')!.companions!.find((c) => c.role === 'vae')!.identify
    expect(nameMatches(ae, 'ae.safetensors')).toBe(true)
    expect(nameMatches(ae, 'ae_fp16.safetensors')).toBe(true)
    expect(nameMatches(ae, 'ae.sft')).toBe(true)
    expect(nameMatches(ae, 'some_other_vae.safetensors')).toBe(false)

    // Z-Image's Qwen3-4B must NOT swallow krea2's qwen3vl_4b_fp8_scaled.
    const z = registryEntry('z-image')!.companions!.find((c) => c.role === 'clip')!.identify
    expect(nameMatches(z, 'qwen_3_4b.safetensors')).toBe(true)
    expect(nameMatches(z, 'qwen3vl_4b_fp8_scaled.safetensors')).toBe(false)
  })

  it('never matches on an absent hint', () => {
    expect(nameMatches({}, 'anything')).toBe(false)
  })
})

describe('archInfoFor', () => {
  it('prefers a supplied (registry) table, then the compiled one, then a default', () => {
    const table = { custom: { ...DEFAULT_ARCH_INFO, steps: 3 } }
    expect(archInfoFor('custom', table).steps).toBe(3)
    expect(archInfoFor('flux1').steps).toBe(ARCH_INFO.flux1.steps)
    // An architecture nobody has heard of must not crash the UI.
    expect(archInfoFor('whatever-ships-next-month')).toEqual(DEFAULT_ARCH_INFO)
  })
})
