import type { GenModel, DiffusionWiring, GenArch } from '@shared/genArch'
import { registryEntry } from '../registry/load'
import { GGUF_UNET_NODE } from './workflow'

// Before queueing, reconcile with the ACTUAL ComfyUI on the other end via
// /object_info, instead of trusting filesystem-derived names and assuming node
// availability. This fixes three classes of failure at once:
//  - name mismatch: ComfyUI lists nested models with the OS separator (backslash
//    on Windows) and its own casing; we pass what /object_info reports verbatim.
//  - missing model: a reused ComfyUI (e.g. an already-running one on :8188) that
//    doesn't have our extra_model_paths won't see a file — caught here clearly.
//  - old/new ComfyUI: a needed node or CLIPLoader "type" enum value that doesn't
//    exist yields a precise "update ComfyUI" message, not a raw 400.

type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown[]> } }>

async function fetchObjectInfo(baseUrl: string): Promise<ObjectInfo> {
  const r = await fetch(`${baseUrl}/object_info`, { signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`Could not read ComfyUI capabilities (${r.status}).`)
  return (await r.json()) as ObjectInfo
}

/** The list of accepted values for a node input (e.g. UNETLoader.unet_name), or
 * [] if the node/input isn't present. */
function acceptedValues(oi: ObjectInfo, node: string, input: string): string[] {
  const req = oi[node]?.input?.required?.[input]
  const list = Array.isArray(req) ? req[0] : undefined
  return Array.isArray(list) ? (list as unknown[]).map(String) : []
}

/** Normalize a filename for separator/case-insensitive comparison. */
function norm(s: string): string {
  return s.replace(/[\\/]+/g, '/').toLowerCase()
}

/** Find the exact string ComfyUI reports for a file we resolved from disk. */
function resolveName(accepted: string[], wanted: string): string | null {
  const w = norm(wanted)
  return accepted.find((a) => norm(a) === w) ?? accepted.find((a) => norm(a).endsWith('/' + w)) ?? null
}

// Which CLIP loader + "type" enum value, and which non-loader nodes, each arch
// needs — read from the registry rather than two hardcoded tables. ComfyUI
// renames a node or a loader `type` enum value from time to time, and when it
// did, the only fix was an app release; now it is a data change.

/** Non-loader nodes this arch's workflow needs to exist in this ComfyUI. */
function extraNodes(arch: GenArch): string[] {
  return registryEntry(arch)?.requires?.nodes ?? []
}

/** The CLIP loader + `type` enum value this arch requires, if any. */
function clipReq(arch: GenArch): { loader: 'DualCLIPLoader' | 'CLIPLoader'; type: string } | null {
  const c = registryEntry(arch)?.requires?.clipLoader
  return c ? { loader: c.node, type: c.type } : null
}

export interface Resolved {
  /** The model name to put in the workflow (exactly as ComfyUI lists it). */
  model: string
  /** Resolved loader wiring for a diffusion model (undefined for checkpoints). */
  wiring?: DiffusionWiring
}

function missingNodeError(arch: GenArch, node: string): Error {
  // The GGUF loader is not part of ComfyUI — telling the user to "update
  // ComfyUI" would send them somewhere that can never fix it.
  if (node === GGUF_UNET_NODE)
    return new Error(
      'Running a GGUF model needs the ComfyUI-GGUF custom node. Install it in ComfyUI (github.com/city96/ComfyUI-GGUF), restart ComfyUI, then try again.'
    )
  const note = registryEntry(arch)?.requires?.minComfyNote
  return new Error(
    note ?? `Your ComfyUI is missing the "${node}" node — update ComfyUI to the latest version and try again.`
  )
}

/**
 * Validate + resolve a model (and its companions) against the live ComfyUI. Throws
 * a clear, actionable Error if a node/type is missing or a file the server can't
 * see, so generation never fails with a raw 400 or a wrong-separator name.
 */
export async function resolveAgainstComfy(
  baseUrl: string,
  gm: GenModel,
  /** "Try anyway": skip the per-arch node/type requirements, which describe a
   * workflow we are not using. The generic graph's own nodes are still checked,
   * and ComfyUI's error is surfaced verbatim if it refuses. */
  tryAnyway = false
): Promise<Resolved> {
  const oi = await fetchObjectInfo(baseUrl)
  const need = (node: string): void => {
    if (!oi[node]) throw missingNodeError(gm.arch, node)
  }

  if (gm.source === 'checkpoint') {
    need('CheckpointLoaderSimple')
    if (!tryAnyway) for (const n of extraNodes(gm.arch)) need(n)
    const ckpt = resolveName(acceptedValues(oi, 'CheckpointLoaderSimple', 'ckpt_name'), gm.name)
    if (!ckpt)
      throw new Error(
        `ComfyUI doesn't see the checkpoint "${gm.name}". If ComfyUI was already running, it may be using different model folders — close it and let Filesmith launch it, or add this folder to ComfyUI.`
      )
    return { model: ckpt }
  }

  // Diffusion model: UNET + CLIP(+2) + VAE, all resolved to ComfyUI's own names.
  // A quantized model loads through ComfyUI-GGUF's node instead.
  const unetNode = gm.source === 'gguf' ? GGUF_UNET_NODE : 'UNETLoader'
  need(unetNode)
  need('VAELoader')
  if (!tryAnyway) for (const n of extraNodes(gm.arch)) need(n)
  const clip = clipReq(gm.arch) ?? (tryAnyway ? { loader: 'CLIPLoader' as const, type: '' } : null)
  if (!clip)
    throw new Error(
      `No CLIP loader is defined for "${gm.arch}". Its registry entry is incomplete — reinstall Filesmith or fix the entry.`
    )
  need(clip.loader)
  // The CLIPLoader/DualCLIPLoader "type" enum must include this arch's value; if
  // not, the node exists but this ComfyUI is too old for this architecture.
  const types = acceptedValues(oi, clip.loader, 'type')
  if (clip.type && types.length && !types.includes(clip.type))
    throw missingNodeError(gm.arch, `${clip.loader} type "${clip.type}"`)

  const w = gm.wiring
  if (!w) throw new Error('This model has no resolved loader wiring; rescan and try again.')

  const unet = resolveName(acceptedValues(oi, unetNode, 'unet_name'), w.unet)
  const vae = resolveName(acceptedValues(oi, 'VAELoader', 'vae_name'), w.vae)
  const clipInput = clip.loader === 'DualCLIPLoader' ? 'clip_name1' : 'clip_name'
  const clipList = acceptedValues(oi, clip.loader, clipInput).concat(
    clip.loader === 'DualCLIPLoader' ? acceptedValues(oi, clip.loader, 'clip_name2') : []
  )
  const clip1 = resolveName(clipList, w.clip)
  const clip2 = w.clip2 ? resolveName(clipList, w.clip2) : undefined

  const notSeen: string[] = []
  if (!unet) notSeen.push(w.unet)
  if (!vae) notSeen.push(w.vae)
  if (!clip1) notSeen.push(w.clip)
  if (w.clip2 && !clip2) notSeen.push(w.clip2)
  if (notSeen.length)
    throw new Error(
      `ComfyUI can't see: ${notSeen.join(', ')}. If ComfyUI was already running it may use different model folders — close it so Filesmith can launch it with the right paths.`
    )

  const wiring: DiffusionWiring = { unet: unet!, clip: clip1!, vae: vae! }
  if (clip2) wiring.clip2 = clip2
  return { model: unet!, wiring }
}
