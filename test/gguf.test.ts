import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { readGgufHeader } from '../src/main/generate/ggufScan'
import { classifyArch } from '../src/main/generate/archScan'
import { deriveGgufWorkflow, GGUF_UNET_NODE } from '../src/main/generate/workflow'
import { registryEntry } from '../src/main/registry/load'
import { entryFromApiWorkflow } from '../src/main/registry/userLayer'
import type { WorkflowNode } from '../src/shared/registry'

const dir = mkdtempSync(join(tmpdir(), 'filesmith-gguf-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// --- a minimal GGUF v3 writer, so the parser is tested against real bytes ---

function str(s: string): Buffer {
  const b = Buffer.from(s, 'utf-8')
  const len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(b.length))
  return Buffer.concat([len, b])
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}
function u64(n: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(BigInt(n))
  return b
}

/**
 * Write a GGUF with the given tensor names + string metadata. `extra` holds raw
 * KV entries as key/type/value TRIPLES, so the count divides by three.
 */
function writeGguf(
  name: string,
  tensors: string[],
  meta: Record<string, string> = {},
  extra: Buffer[] = []
): string {
  const parts: Buffer[] = [
    Buffer.from('GGUF', 'ascii'),
    u32(3),
    u64(tensors.length),
    u64(Object.keys(meta).length + extra.length / 3)
  ]
  for (const [k, v] of Object.entries(meta)) parts.push(str(k), u32(8), str(v))
  parts.push(...extra)
  for (const t of tensors) {
    parts.push(str(t), u32(2), u64(64), u64(64), u32(0), u64(0))
  }
  parts.push(Buffer.alloc(64)) // a token of "weights"
  const p = join(dir, name)
  writeFileSync(p, Buffer.concat(parts))
  return p
}

describe('reading a GGUF header', () => {
  it('extracts tensor names, so the ORDINARY classifier can identify it', () => {
    // The whole point: a quantized Flux has the same tensor names as the
    // safetensors build, so identification needs no new rules and no filename
    // guessing — it stays content-based like everything else.
    const p = writeGguf(
      'flux-q4.gguf',
      ['double_blocks.0.w', 'single_blocks.0.w', 'img_in.w', 'txt_in.w'],
      { 'general.architecture': 'flux', 'general.file_type': 'Q4_K_M' }
    )
    const h = readGgufHeader(p)
    expect(h?.keys).toContain('double_blocks.0.w')
    expect(classifyArch(h!)).toBe('flux1')
  })

  it('surfaces general.architecture where the classifier looks for it', () => {
    const h = readGgufHeader(writeGguf('m.gguf', ['x.w'], { 'general.architecture': 'flux' }))
    expect(h?.metadata['architecture']).toBe('flux')
  })

  it('skips non-string metadata values of every scalar type', () => {
    // The KV block must be walked exactly, or the tensor names read as garbage.
    const extra = [
      str('a.u32'), u32(4), u32(7),
      str('b.f32'), u32(6), Buffer.from(Float32Array.of(1.5).buffer),
      str('c.bool'), u32(7), Buffer.from([1]),
      str('d.u64'), u32(10), u64(9),
      str('e.i16'), u32(3), Buffer.from([0xff, 0xff])
    ]
    const p = writeGguf('mixed.gguf', ['cap_embedder.w', 'noise_refiner.w'], {}, extra)
    expect(readGgufHeader(p)?.keys).toEqual(['cap_embedder.w', 'noise_refiner.w'])
  })

  it('skips array values, including the string arrays a tokenizer carries', () => {
    const strArr = Buffer.concat([u32(8), u64(3), str('a'), str('b'), str('c')])
    const numArr = Buffer.concat([u32(4), u64(4), u32(1), u32(2), u32(3), u32(4)])
    const extra = [str('tok.list'), u32(9), strArr, str('nums'), u32(9), numArr]
    const p = writeGguf('arr.gguf', ['txtfusion.w'], {}, extra)
    expect(readGgufHeader(p)?.keys).toEqual(['txtfusion.w'])
  })

  it('returns null for anything that is not a readable GGUF', () => {
    const bad = join(dir, 'not.gguf')
    writeFileSync(bad, Buffer.from('this is not a gguf file at all'))
    expect(readGgufHeader(bad)).toBeNull()
    writeFileSync(bad, Buffer.concat([Buffer.from('GGUF', 'ascii'), u32(1), u64(1), u64(0)]))
    expect(readGgufHeader(bad)).toBeNull() // v1 is refused rather than mis-parsed
    expect(readGgufHeader(join(dir, 'nope.gguf'))).toBeNull()
  })

  it('refuses an implausible tensor count instead of allocating for it', () => {
    const p = join(dir, 'huge.gguf')
    writeFileSync(
      p,
      Buffer.concat([Buffer.from('GGUF', 'ascii'), u32(3), u64(999_999_999), u64(0)])
    )
    expect(readGgufHeader(p)).toBeNull()
  })
})

describe('the GGUF workflow', () => {
  it('is derived from the family graph by swapping only the UNET loader', () => {
    // Deriving beats duplicating four near-identical graphs in the shipped pack:
    // copies drift, and every future family would have to remember to add one.
    const flux1 = registryEntry('flux1')!.workflow!
    const gguf = deriveGgufWorkflow(flux1)

    const orig = Object.entries(flux1.template).find(([, n]) => n.class_type === 'UNETLoader')!
    const swapped = gguf.template[orig[0]]
    expect(swapped.class_type).toBe(GGUF_UNET_NODE)
    expect(swapped.inputs.unet_name).toBe('${unet}')
    // weight_dtype is meaningless for an already-quantized file and the node
    // rejects the extra input.
    expect(swapped.inputs).not.toHaveProperty('weight_dtype')

    // Every other node is untouched, including the encoder/VAE wiring.
    for (const [id, node] of Object.entries(flux1.template))
      if (node.class_type !== 'UNETLoader') expect(gguf.template[id]).toEqual(node)
  })

  it('leaves a graph with no UNETLoader alone', () => {
    const spec = {
      format: 'comfy-api-v1' as const,
      template: { '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '${model}' } } }
    }
    expect(deriveGgufWorkflow(spec)).toEqual(spec)
  })

  it('covers every shipped diffusion family', () => {
    for (const id of ['flux1', 'flux2', 'z-image', 'krea2']) {
      const wf = registryEntry(id)?.workflow
      expect(wf, `${id} has no workflow`).toBeDefined()
      const derived = deriveGgufWorkflow(wf!)
      expect(Object.values(derived.template).some((n) => n.class_type === GGUF_UNET_NODE)).toBe(true)
    }
  })
})

describe('importing a GGUF workflow exported from ComfyUI', () => {
  it('registers it as a ggufWorkflow and requires the custom node', () => {
    const graph: Record<string, WorkflowNode> = {
      '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'flux-Q4.gguf' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['3', 0] } },
      '3': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['2', 0] } }
    }
    const { entry, notes } = entryFromApiWorkflow(graph, 'my-gguf', 'My GGUF')
    expect(entry.ggufWorkflow).toBeDefined()
    expect(entry.workflow).toBeUndefined()
    expect(entry.ggufWorkflow!.template['1'].inputs.unet_name).toBe('${unet}')
    // Preflight checks this against /object_info, so a missing custom node is
    // reported before anything is queued.
    expect(entry.requires?.nodes).toContain(GGUF_UNET_NODE)
    expect(notes.join(' ')).not.toMatch(/cannot substitute the model file/)
  })
})
