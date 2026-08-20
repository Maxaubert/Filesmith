import { existsSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import type { RegistryEntry, RegistryFile, WorkflowNode } from '@shared/registry'
import {
  KNOWN_PLACEHOLDERS,
  REGISTRY_SCHEMA_VERSION,
  validateEntry,
  workflowPlaceholders
} from '@shared/registry'
import { ensureUserLayers, layerDir, registryEntry, reloadRegistry } from './load'

// Writing to the user layer: the "add a model without waiting for a release"
// path. Two shapes are accepted, because those are the two things a user
// actually has to hand:
//
//   1. A registry entry file (or a whole pack) — what you'd write to add a
//      family properly, or to override one field of a built-in.
//   2. A raw ComfyUI **Save (API format)** export — the highest-leverage case
//      by far. A user who can already generate a model inside ComfyUI can now
//      generate it in Filesmith, with no understanding of Filesmith internals.

/** A filesystem-safe name for a user file, derived from an entry id. */
function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'entry'
}

export interface ImportResult {
  ok: boolean
  error?: string
  /** Ids that were added or overridden. */
  ids?: string[]
  /** Where it was written. */
  path?: string
  /** Non-fatal notes (e.g. which placeholders were detected in a workflow). */
  notes?: string[]
}

function userFile(name: string): string | null {
  const dir = layerDir('user')
  if (!dir) return null
  ensureUserLayers()
  let path = join(dir, `${name}.json`)
  // Never silently replace a file the user already has: pick the next free name.
  let n = 2
  while (existsSync(path)) path = join(dir, `${name} (${n++}).json`)
  return path
}

/** Write a validated pack into the user layer. */
export function saveUserPack(entries: RegistryEntry[], name: string): ImportResult {
  // Validate each entry as it will actually be USED: merged field-by-field
  // onto whatever entry it overrides. A companions-only fragment has no
  // kind/label of its own, and validating it standalone rejected the exact
  // partial override the docs promise.
  const errs = entries.flatMap((e) => {
    const base = e?.id ? registryEntry(e.id) : undefined
    return validateEntry(base ? { ...base, ...e } : e)
  })
  if (errs.length) return { ok: false, error: errs.join('; ') }
  const path = userFile(safeName(name))
  if (!path) return { ok: false, error: 'Could not locate your Filesmith data folder.' }
  const pack: RegistryFile = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    entries: entries.map((e) => ({ ...e, provenance: { ...e.provenance, source: 'user' } }))
  }
  writeFileSync(path, JSON.stringify(pack, null, 2))
  reloadRegistry()
  return { ok: true, ids: entries.map((e) => e.id), path }
}

/** True when a parsed JSON object looks like a ComfyUI API-format graph: a flat
 * map of node id -> {class_type, inputs}. */
function looksLikeApiWorkflow(v: unknown): v is Record<string, WorkflowNode> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const vals = Object.values(v as Record<string, unknown>)
  if (!vals.length) return false
  return vals.every(
    (n) =>
      !!n &&
      typeof n === 'object' &&
      typeof (n as WorkflowNode).class_type === 'string' &&
      typeof (n as WorkflowNode).inputs === 'object'
  )
}

/**
 * Turn a raw ComfyUI API-format export into a registry entry.
 *
 * The graph is used verbatim except that the values a generation needs to vary
 * are swapped for placeholders — otherwise every image would come out with the
 * prompt and seed frozen at whatever the user happened to export. We only
 * substitute inputs whose node class makes the meaning unambiguous, and report
 * what was and was not wired so nothing is silently guessed.
 */
export function entryFromApiWorkflow(
  graph: Record<string, WorkflowNode>,
  id: string,
  label: string
): { entry: RegistryEntry; notes: string[] } {
  const notes: string[] = []
  const nodes = new Set<string>()
  const template: Record<string, WorkflowNode> = {}
  let clipLoader: { node: 'CLIPLoader' | 'DualCLIPLoader'; type: string } | undefined
  let sawUnet = false
  let sawGguf = false
  let sawCheckpoint = false
  let positiveDone = false

  for (const [nid, node] of Object.entries(graph)) {
    nodes.add(node.class_type)
    const inputs: Record<string, unknown> = { ...node.inputs }
    switch (node.class_type) {
      case 'UNETLoader':
        inputs.unet_name = '${unet}'
        sawUnet = true
        break
      // A workflow exported from a GGUF setup loads through ComfyUI-GGUF's node.
      case 'UnetLoaderGGUF':
        inputs.unet_name = '${unet}'
        sawGguf = true
        break
      case 'CheckpointLoaderSimple':
        inputs.ckpt_name = '${model}'
        sawCheckpoint = true
        break
      case 'VAELoader':
        inputs.vae_name = '${vae}'
        break
      case 'CLIPLoader':
        inputs.clip_name = '${clip}'
        if (typeof node.inputs.type === 'string')
          clipLoader = { node: 'CLIPLoader', type: node.inputs.type }
        break
      case 'DualCLIPLoader':
        inputs.clip_name1 = '${clip}'
        inputs.clip_name2 = '${clip2}'
        if (typeof node.inputs.type === 'string')
          clipLoader = { node: 'DualCLIPLoader', type: node.inputs.type }
        break
      case 'CLIPTextEncode':
        // The first text encode is the positive prompt, the next the negative —
        // ComfyUI's own convention, and all the graph itself tells us.
        inputs.text = positiveDone ? '${negative}' : '${prompt}'
        positiveDone = true
        break
      case 'EmptyLatentImage':
      case 'EmptySD3LatentImage':
        inputs.width = '${width}'
        inputs.height = '${height}'
        inputs.batch_size = '${batch}'
        break
      case 'KSampler':
        inputs.seed = '${seed}'
        inputs.steps = '${steps}'
        break
      case 'SaveImage':
        inputs.filename_prefix = '${prefix}'
        break
      default:
        break
    }
    template[nid] = { class_type: node.class_type, inputs }
  }

  if (!sawUnet && !sawGguf && !sawCheckpoint)
    notes.push(
      'No UNETLoader or CheckpointLoaderSimple was found, so Filesmith cannot substitute the model file. The graph will always use whatever it was exported with.'
    )
  if (!positiveDone) notes.push('No CLIPTextEncode was found, so the prompt is not wired in.')
  if (!nodes.has('SaveImage'))
    notes.push('No SaveImage node — Filesmith reads generated images from SaveImage output.')

  // Sampler defaults are read straight off the exported KSampler, so the model
  // keeps the settings it was actually exported working with (a distilled model
  // needs cfg 1, and inheriting someone else's 7 produces garbage).
  const ks = Object.values(graph).find((n) => n.class_type === 'KSampler')?.inputs ?? {}
  const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d)
  const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d)
  const guidance = Object.values(graph).find((n) => n.class_type === 'FluxGuidance')?.inputs
    ?.guidance

  const entry: RegistryEntry = {
    id,
    kind: 'generate',
    label,
    group: label,
    provenance: { source: 'user', addedAt: new Date().toISOString() },
    capabilities: { task: 'text-to-image', minDim: 256, maxDim: 2048, dimStep: 8 },
    sampler: {
      name: str(ks.sampler_name, 'euler'),
      scheduler: str(ks.scheduler, 'normal'),
      steps: num(ks.steps, 20),
      cfg: num(ks.cfg, 7),
      guidance: num(guidance, 0),
      hasGuidance: guidance != null
    },
    requires: {
      nodes: [...nodes].filter(
        (n) => !/^(UNETLoader|VAELoader|CLIPLoader|DualCLIPLoader)$/.test(n)
      ),
      ...(clipLoader ? { clipLoader } : {})
    },
    [sawGguf ? 'ggufWorkflow' : sawCheckpoint && !sawUnet ? 'checkpointWorkflow' : 'workflow']: {
      format: 'comfy-api-v1',
      template
    }
  }
  return { entry, notes }
}

/**
 * Import a JSON file the user picked: a registry pack, a single entry, or a
 * ComfyUI API-format workflow. Everything goes through the same validation the
 * loader uses, so an import can never write an entry the loader would reject.
 */
export function importRegistryJson(path: string, text: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return {
      ok: false,
      error: `That file is not valid JSON (${e instanceof Error ? e.message : e}).`
    }
  }
  const stem = basename(path).replace(/\.json$/i, '')

  // (a) a pack
  const asPack = parsed as RegistryFile
  if (asPack && Array.isArray(asPack.entries))
    return saveUserPack(asPack.entries as RegistryEntry[], stem)

  // (b) a single entry — or a partial override of an entry that already
  // exists (it has an id but no kind of its own).
  const asEntry = parsed as RegistryEntry
  if (
    asEntry &&
    typeof asEntry === 'object' &&
    typeof asEntry.id === 'string' &&
    (asEntry.kind || registryEntry(asEntry.id))
  )
    return saveUserPack([asEntry], asEntry.id)

  // (c) a raw ComfyUI API-format workflow
  if (looksLikeApiWorkflow(parsed)) {
    const id = stem.toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'my-model'
    const { entry, notes } = entryFromApiWorkflow(parsed, id, stem)
    const wf = entry.workflow ?? entry.checkpointWorkflow
    const unknown = wf
      ? workflowPlaceholders(wf).filter((p) => !KNOWN_PLACEHOLDERS.includes(p))
      : []
    if (unknown.length)
      return {
        ok: false,
        error: `That workflow uses placeholders Filesmith can't fill: ${unknown.join(', ')}`
      }
    const res = saveUserPack([entry], id)
    return res.ok ? { ...res, notes } : res
  }

  return {
    ok: false,
    error:
      "That JSON isn't a Filesmith registry file or a ComfyUI API-format workflow. In ComfyUI use Workflow -> Export (API) and pick that file."
  }
}
