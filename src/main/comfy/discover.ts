import { spawn } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import type { ComfyModel, ComfyProbe } from '@shared/comfy'
import { classifyModel } from '@shared/comfy'
import { pidKernelCache, spandrelServerScript } from '../pid/paths'
import { comfyCandidateDirs, comfyNestedDirs } from './roots'
import { resolveSpandrelPython } from './pythonEnv'

// `.pt` is deliberately EXCLUDED from the bulk scan. Reading the installed
// spandrel loader: `.pth`/`.ckpt` go through pickle_module=RestrictedUnpickle
// and `.safetensors` through load_file — both safe — but `.pt` reaches
// `torch.jit.load` with NO restriction, and a scan loads every file in the
// folder, including ones the user never chose. A `.pt` is still selectable
// individually; it just isn't opened en masse because it happened to be nearby.
const MODEL_EXTS = ['.pth', '.safetensors', '.ckpt']

/**
 * Best guess at where the user's ComfyUI lives, so the folder picker opens there
 * instead of a blank Explorer. Prefers a folder that actually has
 * `upscale_models`; falls back to anything that looks like a ComfyUI tree.
 * Returns undefined if nothing plausible is found (the picker opens at default).
 */
export function guessComfyFolder(): string | undefined {
  const dirExists = (d: string): boolean => {
    try {
      return existsSync(d) && statSync(d).isDirectory()
    } catch {
      return false
    }
  }
  const hasUpscale = (d: string): boolean =>
    comfyNestedDirs(d).some((n) => dirExists(join(n, 'models', 'upscale_models')))
  const looksLikeComfy = (d: string): boolean =>
    comfyNestedDirs(d).some((n) => dirExists(join(n, 'models')) || existsSync(join(n, 'main.py')))

  const candidates = comfyCandidateDirs()

  // First a strong match (has upscale_models), then a weak one (looks like Comfy).
  return (
    candidates.find((d) => dirExists(d) && hasUpscale(d)) ??
    candidates.find((d) => dirExists(d) && looksLikeComfy(d))
  )
}

/**
 * The `upscale_models` directories to scan, given whatever folder the user
 * picked — the ComfyUI root, a `models/` dir, or an `upscale_models/` dir are all
 * accepted. Also reads `extra_model_paths.yaml` (best effort) to pick up
 * additional upscale-model locations (the shared-folder case).
 */
export function resolveUpscaleDirs(picked: string): string[] {
  const dirs = new Set<string>()
  const add = (d: string): void => {
    if (d && existsSync(d) && statSync(d).isDirectory()) dirs.add(resolve(d))
  }

  if (basename(picked).toLowerCase() === 'upscale_models') add(picked)
  // Common layouts under the picked folder (the shared nesting depths).
  for (const n of comfyNestedDirs(picked)) {
    add(join(n, 'upscale_models'))
    add(join(n, 'models', 'upscale_models'))
    const cfg = join(n, 'extra_model_paths.yaml')
    if (existsSync(cfg)) resolveExtraPaths(cfg).forEach(add)
  }
  return [...dirs]
}

/**
 * Minimal `extra_model_paths.yaml` reader (no YAML dependency): pairs each
 * `base_path:` with the following `upscale_models:` entry in the same block and
 * yields the resolved directory. Handles absolute or base-relative entries.
 */
function resolveExtraPaths(cfgPath: string): string[] {
  let text: string
  try {
    text = readFileSync(cfgPath, 'utf-8')
  } catch {
    return []
  }
  const out: string[] = []
  let base = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const bm = /^base_path:\s*(.+)$/.exec(line)
    if (bm) {
      base = bm[1].trim().replace(/^["']|["']$/g, '')
      continue
    }
    const um = /^upscale_models:\s*(.+)$/.exec(line)
    if (um) {
      const val = um[1].trim().replace(/^["']|["']$/g, '')
      // A value may itself be a list item or a plain path.
      const p = isAbsolute(val) ? val : base ? join(base, val) : join(dirname(cfgPath), val)
      out.push(p)
    }
  }
  return out
}

/**
 * Look for the user's existing PiD weights inside a ComfyUI install so the
 * installer can COPY them in instead of re-downloading ~3 GB. PiD ships in
 * `models/nvidia_pid/checkpoints/` — searched at the same candidate roots (and
 * nesting depths) as guessComfyFolder. Returns both files only when both exist
 * and are non-empty.
 */
/** Candidate ComfyUI "models" base dirs (holding checkpoints/, nvidia_pid/, …),
 * from the browsed folder first, then the usual auto-detected locations. */
export function comfyModelsBases(): string[] {
  const bases: string[] = []
  const addBases = (dir: string): void => {
    for (const nested of comfyNestedDirs(dir)) bases.push(nested, join(nested, 'models'))
    bases.push(dirname(dir)) // if `dir` is …/models/upscale_models
  }
  for (const dir of comfyCandidateDirs()) addBases(dir)
  // ComfyUI Desktop (the official installer): its user data + configured model
  // base live under %APPDATA%\ComfyUI; read its config for the real base_path.
  for (const b of comfyDesktopBases()) addBases(b)
  return [...new Set(bases)]
}

/** Model base dirs for a ComfyUI Desktop install: %APPDATA%\ComfyUI itself and
 * whatever base_path its config records (best-effort, no YAML dependency). */
export function comfyDesktopBases(): string[] {
  const out: string[] = []
  const appdata = process.env.APPDATA
  if (!appdata) return out
  const userData = join(appdata, 'ComfyUI')
  if (existsSync(userData)) out.push(userData)
  for (const cfg of [
    join(userData, 'extra_models_config.yaml'),
    join(userData, 'config.json'),
    join(userData, 'basePath')
  ]) {
    if (!existsSync(cfg)) continue
    try {
      const text = readFileSync(cfg, 'utf-8')
      // Match a JSON "basePath": "..." or a YAML base_path: ... entry.
      for (const m of text.matchAll(/(?:"?base[_ ]?path"?\s*[:=]\s*)"?([^"\r\n]+)"?/gi)) {
        const p = m[1].trim().replace(/[",]+$/, '')
        if (p && existsSync(p)) out.push(p, join(p, 'models'))
      }
    } catch {
      /* ignore unreadable config */
    }
  }
  return out
}

/** Checkpoint filenames ComfyUI can see (for the generation model picker).
 * Returned as ComfyUI names them: relative to models/checkpoints, forward slashes. */
export function findComfyCheckpoints(): string[] {
  const found = new Set<string>()
  // Cycle + depth guard, matching scanModelFiles below. A junctioned shared
  // models folder otherwise recursed until the app hung.
  const visited = new Set<string>()
  const walk = (dir: string, rel: string, depth = 0): void => {
    if (depth > 4) return
    const vk = resolve(dir)
    if (visited.has(vk)) return
    visited.add(vk)
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      const r = rel ? `${rel}/${e}` : e
      if (st.isDirectory()) walk(p, r, depth + 1)
      // Show every checkpoint — name-based filtering was unreliable (it hid
      // usable models). A checkpoint that can't generate is handled by Cancel.
      else if (/\.(safetensors|ckpt)$/i.test(e)) found.add(r)
    }
  }
  for (const base of comfyModelsBases()) walk(join(base, 'checkpoints'), '')
  return [...found].sort()
}

export function findComfyPidWeights(
  checkpointDirName: string
): { checkpoint: string; vae: string } | null {
  const bases = comfyModelsBases()

  // Require roughly the real sizes so a truncated / still-downloading ComfyUI
  // weight isn't reused and trusted (the checkpoint is ~2.6 GB, the VAE ~320 MB).
  const bigEnough = (p: string, minBytes: number): boolean => {
    try {
      const st = statSync(p)
      return st.isFile() && st.size >= minBytes
    } catch {
      return false
    }
  }
  for (const base of bases) {
    const pidDir = join(base, 'nvidia_pid', 'checkpoints')
    const checkpoint = join(pidDir, checkpointDirName, 'model_ema_bf16.pth')
    const vae = join(pidDir, 'ae.safetensors')
    if (bigEnough(checkpoint, 2_000_000_000) && bigEnough(vae, 200_000_000))
      return { checkpoint, vae }
  }
  return null
}

/** Every model file under the given dirs (recursive, dedup by absolute path). */
export function scanModelFiles(dirs: string[]): string[] {
  const found = new Set<string>()
  const visited = new Set<string>()
  const walk = (dir: string): void => {
    // Guard against a symlink/junction cycle recursing forever.
    const key = resolve(dir)
    if (visited.has(key)) return
    visited.add(key)
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p)
      else if (MODEL_EXTS.some((x) => e.toLowerCase().endsWith(x))) found.add(resolve(p))
    }
  }
  dirs.forEach(walk)
  return [...found]
}

/**
 * Probe model files with spandrel on CPU (no GPU) to identify architecture and
 * native scale. One process for the whole batch: paths in on stdin, one JSON
 * classification per line out.
 */
export function probeModels(paths: string[]): Promise<ComfyProbe[]> {
  if (!paths.length) return Promise.resolve([])
  return new Promise((resolvePromise) => {
    const proc = spawn(resolveSpandrelPython(), [spandrelServerScript(), '--probe'], {
      windowsHide: true,
      env: {
        ...process.env,
        FILESMITH_PID_CACHE: pidKernelCache(),
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8'
      }
    })
    // Watchdog: a model that hangs spandrel must not wedge the scan forever.
    // Killing the process fires 'close', which resolves with what we have.
    const watchdog = setTimeout(() => proc.kill(), 120_000)
    const byPath = new Map<string, ComfyProbe>()
    let buf = ''
    proc.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const s = line.trim()
        if (!s.startsWith('{')) continue
        try {
          const m = JSON.parse(s) as ComfyProbe
          if (m.path) byPath.set(resolve(m.path), m)
        } catch {
          /* ignore non-JSON diagnostics */
        }
      }
    })
    const done = (): void => {
      clearTimeout(watchdog)
      // Any path with no reply (spandrel crashed/hung on it) is unsupported.
      resolvePromise(
        paths.map(
          (p) =>
            byPath.get(resolve(p)) ?? { path: p, ok: false, reason: 'could not be read' }
        )
      )
    }
    proc.on('error', done)
    proc.on('close', done)
    proc.stdin.on('error', () => {})
    proc.stdin.write(paths.join('\n') + '\n')
    proc.stdin.end()
  })
}

/** Full scan of the picked folder into classified models (needs the env ready). */
export async function scanComfy(picked: string): Promise<ComfyModel[]> {
  const dirs = resolveUpscaleDirs(picked)
  const files = scanModelFiles(dirs)
  const probes = await probeModels(files)
  return probes
    .map((p) => classifyModel(p))
    .sort((a, b) => {
      const rank = { verified: 0, experimental: 1, unsupported: 2 }
      return rank[a.badge] - rank[b.badge] || a.name.localeCompare(b.name)
    })
}
