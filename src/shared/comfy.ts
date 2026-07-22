// Types + pure classification for ComfyUI-imported upscale models, shared by the
// engine (scan) and the renderer (picker). No Node/Electron imports here.

export type ComfyBadge = 'verified' | 'experimental' | 'unsupported'

export interface ComfyModel {
  /** Absolute path to the model file — the id used to select it. */
  path: string
  /** Display name (filename without extension). */
  name: string
  /** spandrel architecture name, when it loaded. */
  arch?: string
  /** Native upscale factor the model was trained for (2/4/8…). */
  scale: number
  badge: ComfyBadge
  /** Why it's unsupported (for the greyed "Not usable" list). */
  reason?: string
}

/** Raw result of probing one file with spandrel (CPU, no GPU). */
export interface ComfyProbe {
  path: string
  ok: boolean
  arch?: string
  scale?: number
  reason?: string
}

// Known-good upscalers: normalized-name tokens that mark a model "Verified".
// Matching is substring on the alphanumeric-only, lower-cased filename, so
// "4x-UltraSharpV2.safetensors" -> "4xultrasharpv2" matches "ultrasharp".
export const VERIFIED_TOKENS: string[] = [
  'ultrasharp',
  'remacri',
  'siax',
  'nmkd',
  'animesharp',
  'realesrgan',
  'realesrganx4',
  'lsdir',
  'nomos',
  'foolhardy',
  'ultramix',
  'lollypop',
  'superscale',
  'valar',
  'fatality'
]

/** Normalize a filename to alphanumerics for tolerant matching. */
export function normalizeModelName(name: string): string {
  return name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]/g, '')
}

/** Classify a probed model into a badge. Pure. */
export function classifyModel(
  probe: ComfyProbe,
  tokens: string[] = VERIFIED_TOKENS
): ComfyModel {
  const base = probe.path.split(/[\\/]/).pop() ?? probe.path
  const name = base.replace(/\.[^.]+$/, '')
  if (!probe.ok) {
    return { path: probe.path, name, scale: 0, badge: 'unsupported', reason: probe.reason }
  }
  const norm = normalizeModelName(base)
  const verified = tokens.some((t) => norm.includes(t))
  return {
    path: probe.path,
    name,
    arch: probe.arch,
    scale: probe.scale ?? 0,
    badge: verified ? 'verified' : 'experimental'
  }
}
