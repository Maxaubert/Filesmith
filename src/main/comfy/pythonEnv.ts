import { existsSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { pidVenvPython } from '../pid/paths'
import { readComfyStore } from './store'

// Reuse ComfyUI's own Python for the spandrel (ESRGAN) upscale path. ComfyUI
// already ships torch + spandrel + numpy + PIL — everything our sidecar needs —
// and its torch is, by construction, matched to the user's GPU. Running our
// sidecar script with THAT interpreter (read-only; we install nothing into it,
// touch none of their files) lets the ComfyUI-models feature work with NO
// multi-GB env download. PiD still needs our own env (extra package + CUDA build).

// The env dir for a python.exe: <env>/Scripts/python.exe -> <env>, else its dir.
function envDirOf(py: string): string {
  const d = dirname(py)
  return basename(d).toLowerCase() === 'scripts' ? dirname(d) : d
}

// Fast, import-free readiness check: the env's site-packages has torch + spandrel.
function hasTorchSpandrel(py: string): boolean {
  const sp = join(envDirOf(py), 'Lib', 'site-packages')
  return existsSync(join(sp, 'torch')) && existsSync(join(sp, 'spandrel'))
}

/** Candidate ComfyUI "code root" dirs (where a venv/embedded python would live),
 * checked at a few nesting depths near the remembered + common install spots. */
function comfyCodeRoots(): string[] {
  const roots: string[] = []
  const add = (d: string): void => {
    roots.push(d, join(d, 'ComfyUI'), join(d, 'ComfyUI', 'ComfyUI'))
  }
  const remembered = readComfyStore()?.folder
  if (remembered) add(remembered)
  const home = homedir()
  const bases = [home, join(home, 'Desktop'), join(home, 'Documents'), join(home, 'Downloads'), 'C:\\', 'D:\\', 'E:\\']
  const names = ['ComfyUI', 'ComfyUI-Installs', 'ComfyUI_windows_portable', 'comfyui', 'ComfyUI-Shared']
  for (const b of bases) for (const n of names) add(join(b, n))
  return roots
}

// Common interpreter locations within a ComfyUI code root.
const PY_SUBS = [
  ['.venv', 'Scripts', 'python.exe'],
  ['python_embeded', 'python.exe'],
  ['standalone-env', 'python.exe'],
  ['venv', 'Scripts', 'python.exe']
]

let cached: { py: string | null } | null = null

/** A ComfyUI Python that already has torch + spandrel, or null if none found. */
export function findComfyPython(): string | null {
  if (cached) return cached.py
  let found: string | null = null
  outer: for (const root of comfyCodeRoots())
    for (const sub of PY_SUBS) {
      const py = join(root, ...sub)
      if (existsSync(py) && hasTorchSpandrel(py)) {
        found = py
        break outer
      }
    }
  cached = { py: found }
  return found
}

/** Re-probe on next call (e.g. after the user points at a new ComfyUI folder). */
export function clearComfyPythonCache(): void {
  cached = null
}

/** The interpreter to run the spandrel sidecar with: the user's ComfyUI Python
 * when usable (no download needed), else our own installed venv. */
export function resolveSpandrelPython(): string {
  return findComfyPython() ?? pidVenvPython()
}

/** True when the spandrel engine can run with no install — a ComfyUI Python has
 * what we need. */
export function comfyPythonReady(): boolean {
  return findComfyPython() != null
}
