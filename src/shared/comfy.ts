// Types + pure classification for ComfyUI-imported upscale models, shared by the
// engine (scan) and the renderer (picker). No Node/Electron imports here.
import { baseName } from './fileKind'

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

/**
 * spandrel architectures we have run and trust. This is the PRIMARY verification
 * signal: it comes from actually loading the file, so it keeps working for a
 * model released after this build — which the filename token list below cannot,
 * by construction. (Every upscaler published after the day VERIFIED_TOKENS was
 * written was badged "experimental" purely for having a name nobody had listed.)
 */
export const VERIFIED_ARCHS: string[] = [
  'ESRGAN',
  'RealESRGAN',
  'SPAN',
  'DAT',
  'HAT',
  'OmniSR',
  'SwinIR',
  'Swin2SR',
  'RealCUGAN',
  'Compact',
  'SRVGGNetCompact',
  'PLKSR',
  'RealPLKSR',
  'ATD',
  'DRCT',
  'SCUNet'
]

// A secondary signal: normalized-name tokens for well-known community models
// whose architecture alone doesn't settle it. Matching is substring on the
// alphanumeric-only, lower-cased filename, so "4x-UltraSharpV2.safetensors" ->
// "4xultrasharpv2" matches "ultrasharp".
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
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Classify a probed model into a badge. Pure.
 *
 * The ARCHITECTURE decides first — that is what spandrel actually read out of
 * the file — and the filename tokens are only a fallback. The other way round,
 * every upscaler released after this build was badged "experimental" for the
 * sole reason that nobody had added its name to a list. A badge has never
 * affected availability (an unknown-but-loadable model stays fully usable); this
 * makes the badge mean something instead of tracking the calendar.
 */
export function classifyModel(
  probe: ComfyProbe,
  tokens: string[] = VERIFIED_TOKENS,
  archs: string[] = VERIFIED_ARCHS
): ComfyModel {
  const base = baseName(probe.path)
  const name = base.replace(/\.[^.]+$/, '')
  if (!probe.ok) {
    return { path: probe.path, name, scale: 0, badge: 'unsupported', reason: probe.reason }
  }
  const norm = normalizeModelName(base)
  const archOk =
    probe.arch != null && archs.some((a) => a.toLowerCase() === probe.arch!.toLowerCase())
  const verified = archOk || tokens.some((t) => norm.includes(t))
  return {
    path: probe.path,
    name,
    arch: probe.arch,
    scale: probe.scale ?? 0,
    badge: verified ? 'verified' : 'experimental'
  }
}
