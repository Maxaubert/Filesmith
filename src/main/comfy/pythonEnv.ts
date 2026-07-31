import { existsSync } from 'fs'
import { basename, dirname, join } from 'path'
import { pidVenvPython } from '../pid/paths'
import { comfyCandidateDirs, comfyNestedDirs } from './roots'

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

// Just torch — all that LAUNCHING ComfyUI for generation needs (spandrel is only
// for the ESRGAN upscale sidecar, so gating generation on it wrongly hides a
// perfectly capable ComfyUI that simply hasn't installed spandrel).
function hasTorch(py: string): boolean {
  return existsSync(join(envDirOf(py), 'Lib', 'site-packages', 'torch'))
}

/** Candidate ComfyUI "code root" dirs (where a venv/embedded python would live),
 * checked at a few nesting depths near the remembered + common install spots. */
export function comfyCodeRoots(): string[] {
  const roots: string[] = []
  for (const d of comfyCandidateDirs()) roots.push(...comfyNestedDirs(d))
  return [...new Set(roots)]
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

/** Every torch-capable interpreter we can find, best-first. Does NOT require
 * spandrel (that is only the upscale sidecar) and does NOT require main.py to
 * sit beside it — see findComfyMainPy for why those two are now independent. */
export function findComfyTorchPythons(): string[] {
  const out: string[] = []
  for (const root of comfyCodeRoots())
    for (const sub of PY_SUBS) {
      const py = join(root, ...sub)
      if (existsSync(py) && hasTorch(py)) out.push(py)
    }
  return [...new Set(out)]
}

/**
 * A ComfyUI source tree (a directory containing main.py), searched independently
 * of where the interpreter lives.
 *
 * These MUST be decoupled. ComfyUI **Desktop** puts its uv venv in the base dir
 * the user chose during setup, while ComfyUI's own source ships inside the
 * Electron app under `resources/ComfyUI`. The old rule — interpreter and main.py
 * in the same root — could never be satisfied by that layout, so every Desktop
 * install was reported "ComfyUI wasn't found" forever, no matter what the user
 * did. Desktop is the official installer, i.e. exactly the non-technical user.
 */
export function findComfyMainPy(): string | null {
  for (const root of comfyCodeRoots()) if (existsSync(join(root, 'main.py'))) return root
  return null
}

/** A ComfyUI interpreter capable of LAUNCHING ComfyUI (torch present), for
 * generation. Falls back to the spandrel-capable python if none is found. */
export function findComfyLaunchPython(): string | null {
  return findComfyTorchPythons()[0] ?? findComfyPython()
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
