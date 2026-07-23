import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { run } from './run'

// Core CLI tools bundled in resources/bin (packed by electron-builder into
// process.resourcesPath/bin in production; the repo's resources/bin in dev).
const EXE = process.platform === 'win32' ? '.exe' : ''

function bundledDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin')
}

/**
 * Resolve a tool to a runnable command: the bundled binary if present, else the
 * bare name (the OS resolves it on PATH at spawn time). Returns null only for
 * AI tools handled by the on-demand installer (added in a later phase).
 */
export function resolveTool(name: string): string {
  const bundled = join(bundledDir(), name + EXE)
  return existsSync(bundled) ? bundled : name
}

/**
 * Resolve LibreOffice's `soffice`. LibreOffice is a full install tree (not a
 * single exe), so it lives in resources/libreoffice/ rather than the flat bin
 * dir. Prefer the bundled copy, then PATH, then the usual Windows install dirs.
 * `soffice.com` (the console launcher) is preferred on Windows because it blocks
 * until the headless conversion finishes; `soffice.exe` can return early.
 */
export function resolveSoffice(): string {
  const loRoot = app.isPackaged
    ? join(process.resourcesPath, 'libreoffice')
    : join(app.getAppPath(), 'resources', 'libreoffice')
  const names = process.platform === 'win32' ? ['soffice.com', 'soffice.exe'] : ['soffice']
  for (const n of names) {
    const p = join(loRoot, 'program', n)
    if (existsSync(p)) return p
  }
  if (process.platform === 'win32') {
    for (const p of [
      'C:\\Program Files\\LibreOffice\\program\\soffice.com',
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
    ]) {
      if (existsSync(p)) return p
    }
  }
  return 'soffice'
}

/**
 * Resolve Ghostscript's console binary. Like LibreOffice, Ghostscript is a tree
 * (exe + gsdll + lib + Resource), so it lives in resources/ghostscript/ rather
 * than the flat bin dir; the console exe finds its lib/Resource relative to
 * itself. Prefer the bundled copy, then a Program Files install, then PATH.
 */
export function resolveGhostscript(): string {
  const gsRoot = app.isPackaged
    ? join(process.resourcesPath, 'ghostscript')
    : join(app.getAppPath(), 'resources', 'ghostscript')
  const exe = process.platform === 'win32' ? 'gswin64c.exe' : 'gs'
  const bundled = join(gsRoot, 'bin', exe)
  if (existsSync(bundled)) return bundled
  if (process.platform === 'win32') {
    // Program Files\gs\gs<version>\bin\gswin64c.exe
    for (const base of ['C:\\Program Files\\gs', 'C:\\Program Files (x86)\\gs']) {
      try {
        for (const ver of readdirSync(base)) {
          const p = join(base, ver, 'bin', 'gswin64c.exe')
          if (existsSync(p)) return p
        }
      } catch {
        /* not installed there */
      }
    }
  }
  return exe.replace('.exe', '') // hope it's on PATH
}

/**
 * Resolve Real-ESRGAN's binary. Like Ghostscript it's a small tree (exe + dlls
 * + models/), so it lives in resources/realesrgan and the binary finds its
 * models via the -m flag pointing at the sibling folder.
 */
export function realesrganDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'realesrgan')
    : join(app.getAppPath(), 'resources', 'realesrgan')
}

export function resolveRealesrgan(): string {
  const exe = process.platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan'
  const bundled = join(realesrganDir(), exe)
  if (existsSync(bundled)) return bundled
  return exe.replace('.exe', '') // fall back to PATH
}

/**
 * How to invoke rembg (the Remove Background engine). rembg is Python, so unlike
 * every other tool here it can't be a bundled exe; it runs through uv, which
 * fetches a private Python + rembg on first use.
 *
 * The exact invocation is load-bearing and was arrived at by measurement, not
 * documentation:
 *  - The version MUST be pinned. Unpinned `uv tool run rembg` resolves a
 *    pymatting that needs numba 0.53.1, which refuses to build on Python 3.13+
 *    ("Cannot install on Python version 3.13.13") — the plain command fails
 *    outright on a current machine.
 *  - `--python 3.11` for the same reason: uv otherwise picks the system Python.
 *  - The `cpu` extra is required. `rembg[cli]` alone installs no onnxruntime and
 *    exits with "No onnxruntime backend found" at run time.
 * Cold start (downloading 84 packages) took ~39s; afterwards uv serves it from
 * cache. A locally installed `rembg` is preferred when present since it skips
 * that entirely.
 */
const REMBG_SPEC = 'rembg[cli,cpu]==2.0.75'

export interface RembgCommand {
  cmd: string
  /** Prefix args before rembg's own arguments. */
  prefix: string[]
}

/** Where an already-installed rembg tool lives (a returning user's cache). */
function rembgInstalledPath(): string {
  return join(process.env.APPDATA ?? '', 'uv', 'tools', 'rembg', 'Scripts', 'rembg' + EXE)
}

export interface RembgStatus {
  /** rembg + its model are already installed — no download on next run. */
  ready: boolean
  /** uv is present, so a first-use install/download can proceed. */
  uvAvailable: boolean
}

/** Proactive Remove-Background availability, so the panel can DISCLOSE the AI
 * model + one-time download (and the uv requirement) before the user commits
 * files — rather than failing mid-run. */
export function removebgStatus(): RembgStatus {
  return { ready: existsSync(rembgInstalledPath()), uvAvailable: resolveUv() != null }
}

export function resolveRembg(): RembgCommand | null {
  // (a) an existing uv tool install (what a returning user will have)
  const installed = rembgInstalledPath()
  if (existsSync(installed)) return { cmd: installed, prefix: [] }

  // (b) uv itself, which fetches Python + rembg on demand
  const uv = resolveUv()
  if (uv) return { cmd: uv, prefix: ['tool', 'run', '--python', '3.11', '--from', REMBG_SPEC, 'rembg'] }
  return null
}

/** uv, from winget's package dir, the standard user install, or PATH. */
export function resolveUv(): string | null {
  const candidates = [
    join(
      process.env.LOCALAPPDATA ?? '',
      'Microsoft',
      'WinGet',
      'Packages',
      'astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe',
      'uv' + EXE
    ),
    join(process.env.USERPROFILE ?? '', '.local', 'bin', 'uv' + EXE),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'uv', 'uv' + EXE)
  ]
  const found = candidates.find((p) => existsSync(p))
  return found ?? null
}

/** True if the tool is bundled or answers a version probe on PATH. */
export async function toolAvailable(name: string): Promise<boolean> {
  const bundled = join(bundledDir(), name + EXE)
  if (existsSync(bundled)) return true
  try {
    const { code } = await run(name, ['-version'])
    return code === 0
  } catch {
    return false
  }
}
