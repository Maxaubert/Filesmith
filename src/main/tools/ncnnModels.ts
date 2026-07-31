import { mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { realesrganDir } from '../toolResolver'

/**
 * Real-ESRGAN (ncnn) models, discovered ON DISK.
 *
 * This is the only AI upscaler an AMD or Intel user has — everything else in the
 * app needs CUDA — and it was the least extensible thing in the codebase: which
 * two models shipped was fixed at BUILD time by fetch-binaries.mjs, repeated as
 * a literal in the arg builder, and frozen again as a two-value union in the
 * picker. Nothing anywhere read the models directory, even though the binary is
 * handed it with `-m` and will happily run any `.param`/`.bin` pair found there,
 * on any Vulkan GPU.
 *
 * Now: enumerate what is actually present, plus a user overlay in userData that
 * an app update never touches. Dropping a pair of files in is all it takes.
 */

/** Where a user can add their own ncnn upscalers. */
export function userNcnnDir(): string {
  return join(app.getPath('userData'), 'models', 'realesrgan')
}

export function ensureUserNcnnDir(): void {
  try {
    mkdirSync(userNcnnDir(), { recursive: true })
  } catch {
    /* best effort */
  }
}

export interface NcnnModel {
  /** The `-n` argument: the .param/.bin basename. */
  name: string
  /** The `-m` argument: the directory holding the pair. */
  dir: string
  /** Display label. */
  label: string
  /** True when it came from the user's own folder rather than the installer. */
  user: boolean
}

/** The two models Filesmith has always shipped, and the friendly names the UI
 * and stored sessions use for them. Kept so an existing session that selected
 * 'photo' keeps working. */
const SHIPPED_LABELS: Record<string, string> = {
  'realesrgan-x4plus': 'Photo',
  'realesrgan-x4plus-anime': 'Anime',
  'realesrgan-x4plus-anime_6B': 'Anime (6B)',
  'realesrnet-x4plus': 'Photo (RealESRNet)',
  'realesrgan-animevideov3': 'Anime video'
}

/** Turn a bare model basename into something readable. */
function labelFor(name: string): string {
  if (SHIPPED_LABELS[name]) return SHIPPED_LABELS[name]
  return name
    .replace(/^realesrgan[-_]?/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function scanDir(dir: string, user: boolean): NcnnModel[] {
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return []
  }
  const params = files.filter((f) => f.toLowerCase().endsWith('.param'))
  const out: NcnnModel[] = []
  for (const p of params) {
    const name = p.replace(/\.param$/i, '')
    // A .param without its .bin is half a model; ncnn would fail at load time.
    if (!files.some((f) => f.toLowerCase() === `${name.toLowerCase()}.bin`)) continue
    out.push({ name, dir, label: labelFor(name), user })
  }
  return out
}

/** Every usable ncnn upscaler: bundled first, then the user's own. */
export function listNcnnModels(): NcnnModel[] {
  const dirs: [string, boolean][] = []
  // Both paths come from Electron, which isn't present in unit tests; a missing
  // runtime yields an empty list rather than throwing out of a scan.
  try {
    dirs.push([join(realesrganDir(), 'models'), false])
  } catch {
    /* no Electron */
  }
  try {
    dirs.push([userNcnnDir(), true])
  } catch {
    /* no Electron */
  }
  const found = dirs.flatMap(([d, user]) => scanDir(d, user))
  const seen = new Set<string>()
  return found.filter((m) => {
    const k = m.name.toLowerCase()
    if (seen.has(k)) return false // a bundled model wins over a same-named overlay
    seen.add(k)
    return true
  })
}

/**
 * Pick a model from a list by a stored picker value. Pure, so the aliasing rules
 * are testable without a filesystem.
 *
 * Accepts the legacy 'photo' / 'anime' aliases (existing sessions store those)
 * and `esrgan:<name>`, and degrades to something usable rather than failing: a
 * build that shipped a different model set, or a user whose overlay replaced the
 * defaults, must still be able to upscale.
 */
export function pickNcnnModel(all: NcnnModel[], value: string): NcnnModel | null {
  if (!all.length) return null
  const byName = (n: string): NcnnModel | undefined =>
    all.find((m) => m.name.toLowerCase() === n.toLowerCase())
  const anime = (): NcnnModel => all.find((m) => /anime/i.test(m.name)) ?? all[0]
  const photo = (): NcnnModel => all.find((m) => !/anime/i.test(m.name)) ?? all[0]

  if (value.startsWith('esrgan:')) {
    const found = byName(value.slice('esrgan:'.length))
    if (found) return found
  }
  if (value === 'anime') return byName('realesrgan-x4plus-anime') ?? anime()
  if (value === 'photo') return byName('realesrgan-x4plus') ?? photo()
  return byName(value) ?? photo()
}

/** Resolve a stored picker value against what is actually on disk. */
export function resolveNcnnModel(value: string): NcnnModel | null {
  return pickNcnnModel(listNcnnModels(), value)
}

/** True when at least one usable model pair exists. */
export function hasNcnnModels(): boolean {
  return listNcnnModels().length > 0
}
