import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ComfyModel } from '@shared/comfy'

// Remembered ComfyUI import: the folder the user picked and the last scan. Models
// are REFERENCED IN PLACE (absolute paths), never copied — a rescan re-probes and
// drops any whose file has since disappeared.

export interface ComfyStore {
  /** The folder the user selected (ComfyUI root / models / upscale_models). */
  folder: string
  models: ComfyModel[]
  /** An explicit ComfyUI server to talk to (e.g. a non-default port, or one on
   * another machine). Tried before the default 8188 and before launching ours.
   * Also settable per-run with FILESMITH_COMFY_URL. */
  serverUrl?: string
}

function storePath(): string {
  return join(app.getPath('userData'), 'comfy-upscalers.json')
}

export function readComfyStore(): ComfyStore | null {
  try {
    const p = storePath()
    if (!existsSync(p)) return null
    const data = JSON.parse(readFileSync(p, 'utf-8')) as ComfyStore
    if (!data || typeof data.folder !== 'string' || !Array.isArray(data.models)) return null
    return data
  } catch {
    return null
  }
}

export function writeComfyStore(store: ComfyStore): void {
  writeFileSync(storePath(), JSON.stringify(store, null, 2))
}

/** Update only the given fields, preserving the rest. The whole-object writes
 * in comfy:set-folder / comfy:scan silently deleted a hand-configured
 * serverUrl every time the folder was re-picked. */
export function mergeComfyStore(patch: Partial<ComfyStore>): void {
  const cur = readComfyStore()
  const merged: ComfyStore = {
    folder: patch.folder ?? cur?.folder ?? '',
    models: patch.models ?? cur?.models ?? []
  }
  const serverUrl = patch.serverUrl ?? cur?.serverUrl
  if (serverUrl) merged.serverUrl = serverUrl
  writeComfyStore(merged)
}

/** The usable (loadable) models from the store, filtered to ones still on disk. */
export function usableComfyModels(): ComfyModel[] {
  const store = readComfyStore()
  if (!store) return []
  return store.models.filter((m) => m.badge !== 'unsupported' && existsSync(m.path))
}

/** Look up a remembered model by its path (the id the UI selects). */
export function comfyModelByPath(path: string): ComfyModel | null {
  return usableComfyModels().find((m) => m.path === path) ?? null
}
