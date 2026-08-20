import { mkdirSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { RegistryEntry, RegistryFile } from '@shared/registry'
import { REGISTRY_SCHEMA_VERSION, mergeRegistryChecked } from '@shared/registry'

/**
 * The three-layer model registry.
 *
 *   1. BUILTIN   <app>/resources/registry/*.json        read-only, ships in the installer
 *   2. CHANNEL   %APPDATA%/Filesmith/registry/channel/  OTA-refreshed cache (Phase 7)
 *   3. USER      %APPDATA%/Filesmith/registry/user/     the user's own, never touched
 *
 * Non-negotiable rules:
 *  - An app update replaces layer 1 ONLY. It can never read, write or delete
 *    layer 3. A user's hand-added model survives every update, forever.
 *  - Layer 1 ships in the installer, so a fully offline fresh install has a
 *    complete working catalog. Offline is never degraded relative to before.
 *  - A malformed file disables THAT FILE and surfaces a warning. It never bricks
 *    the registry, and an entry whose schemaVersion exceeds ours is skipped with
 *    a note rather than crashing — a newer channel pack must not break an older
 *    app.
 */

export type Layer = 'builtin' | 'channel' | 'user'

export interface RegistryLoadResult {
  entries: RegistryEntry[]
  /** Human-readable problems, surfaced rather than swallowed. */
  warnings: string[]
}

/**
 * Electron's paths, or null outside an Electron runtime. Resolving this at call
 * time (rather than assuming `app` exists) is what lets the registry — the piece
 * that decides which models exist — be unit-tested against the SHIPPED pack.
 * The audit's M12 was precisely that the machine-dependent resolution code had
 * zero coverage because it could not be loaded outside the app.
 */
function electronPath(kind: 'resources' | 'userData'): string | null {
  try {
    if (kind === 'userData') return app.getPath('userData')
    return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  } catch {
    return null
  }
}

function builtinDir(): string {
  const root = electronPath('resources') ?? join(process.cwd(), 'resources')
  return join(root, 'registry')
}

function userRegistryRoot(): string | null {
  const ud = electronPath('userData')
  return ud ? join(ud, 'registry') : null
}

export function layerDir(layer: Layer): string | null {
  if (layer === 'builtin') return builtinDir()
  const root = userRegistryRoot()
  return root ? join(root, layer) : null
}

/** Create the writable layers so a user can drop a file in without guessing. */
export function ensureUserLayers(): void {
  for (const l of ['channel', 'user'] as const) {
    const dir = layerDir(l)
    if (!dir) continue
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      /* best effort — a read-only profile still runs on layer 1 */
    }
  }
}

function readLayer(layer: Layer, warnings: string[]): { file: string; entries: RegistryEntry[] }[] {
  const dir = layerDir(layer)
  if (!dir) return []
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'))
  } catch {
    return [] // a missing layer is normal, not an error
  }
  const out: { file: string; entries: RegistryEntry[] }[] = []
  for (const f of files.sort()) {
    const path = join(dir, f)
    let parsed: RegistryFile
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8')) as RegistryFile
    } catch (e) {
      warnings.push(
        `${layer}/${f}: not valid JSON (${e instanceof Error ? e.message : e}) — skipped`
      )
      continue
    }
    if (!parsed || !Array.isArray(parsed.entries)) {
      warnings.push(`${layer}/${f}: no "entries" array — skipped`)
      continue
    }
    if ((parsed.schemaVersion ?? 1) > REGISTRY_SCHEMA_VERSION) {
      warnings.push(
        `${layer}/${f}: needs registry schema v${parsed.schemaVersion} but this Filesmith understands v${REGISTRY_SCHEMA_VERSION} — skipped. Update Filesmith to use it.`
      )
      continue
    }
    const entries: RegistryEntry[] = []
    for (const e of parsed.entries) {
      if ((e?.schemaVersion ?? 1) > REGISTRY_SCHEMA_VERSION) {
        warnings.push(`${layer}/${f}: entry "${e?.id}" needs a newer Filesmith — skipped`)
        continue
      }
      // Validation happens on the MERGED entry (mergeRegistryChecked), not the
      // fragment: a companions-only override has no kind/label of its own.
      // Provenance is still assigned by the LAYER, never trusted from the file.
      entries.push({ ...e, provenance: { ...(e.provenance ?? {}), source: layer } })
    }
    out.push({ file: `${layer}/${f}`, entries })
  }
  return out
}

/** mtimes of the WRITABLE layers' files, so a hand-edited user file (the
 * registry:open-folder flow actively invites it) is picked up without an app
 * restart instead of being ignored until the next launch. */
function layerFingerprint(): string {
  const parts: string[] = []
  for (const l of ['channel', 'user'] as const) {
    const dir = layerDir(l)
    if (!dir) continue
    try {
      for (const f of readdirSync(dir).sort()) {
        if (!f.toLowerCase().endsWith('.json')) continue
        try {
          parts.push(`${l}/${f}:${statSync(join(dir, f)).mtimeMs}`)
        } catch {
          /* raced a delete */
        }
      }
    } catch {
      /* missing layer */
    }
  }
  return parts.join('|')
}

let fingerprint = ''

/** Drop the cache when a writable layer changed on disk. Called from the IPC
 * status endpoints so an edit takes effect on the next panel refresh. */
export function invalidateRegistryIfChanged(): void {
  if (!cache) return
  if (layerFingerprint() !== fingerprint) cache = null
}

let cache: RegistryLoadResult | null = null

/** Load + merge all three layers. Cached; call `reloadRegistry` after a change. */
export function loadRegistry(): RegistryLoadResult {
  if (cache) return cache
  const warnings: string[] = []
  const layers = [
    ...readLayer('builtin', warnings),
    ...readLayer('channel', warnings),
    ...readLayer('user', warnings)
  ]
  if (!layers.length)
    warnings.push(
      'No model registry found. Filesmith ships one in resources/registry — this installation looks incomplete.'
    )
  const merged = mergeRegistryChecked(layers)
  warnings.push(...merged.warnings)
  for (const w of warnings) console.warn('[registry]', w)
  fingerprint = layerFingerprint()
  cache = { entries: merged.entries, warnings }
  return cache
}

export function reloadRegistry(): RegistryLoadResult {
  cache = null
  return loadRegistry()
}

/** Every entry of a kind (in layer order: builtin, then channel/user additions). */
export function registryEntries(kind: RegistryEntry['kind']): RegistryEntry[] {
  return loadRegistry().entries.filter((e) => e.kind === kind)
}

/** One entry by id, or undefined. */
export function registryEntry(id: string): RegistryEntry | undefined {
  return loadRegistry().entries.find((e) => e.id === id)
}
