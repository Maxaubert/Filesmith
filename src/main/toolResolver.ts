import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { findUv, findUvAsync, uvOnPathCached } from './uv'

// Core CLI tools bundled in resources/bin (packed by electron-builder into
// process.resourcesPath/bin in production; the repo's resources/bin in dev).
const EXE = process.platform === 'win32' ? '.exe' : ''

/**
 * The Program Files roots, from the environment rather than hardcoded to `C:`.
 * Windows localizes only the Explorer *display* name (the on-disk path is always
 * `\Program Files`), but the drive is not guaranteed to be C: — a machine that
 * boots from D:, or a `ProgramFilesDir` redirect, has neither literal. The
 * literals stay as a last-resort fallback.
 */
function programFilesRoots(): string[] {
  const env = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ].filter((p): p is string => Boolean(p))
  return [...new Set(env)]
}

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
 * Point the bundled ImageMagick at its own coder modules. The shipped magick is
 * the dynamic *modules* build: every format decoder/encoder is a DLL under
 * bin/modules/coders, located at runtime via MAGICK_CODER_MODULE_PATH. Without
 * it, magick falls back to its compiled-in Program Files path — which exists on
 * a dev machine and hides the problem, and does not exist on a clean install,
 * where every image operation dies with "no decode delegate".
 *
 * Set on process.env once at startup so every spawned child inherits it. Only
 * set when the bundled magick + modules are actually present: pointing some
 * other ImageMagick install at our version-specific coders would break it, and
 * when the bundled magick is present resolveTool() always picks it.
 */
export function configureBundledMagickEnv(): void {
  const bin = bundledDir()
  const coders = join(bin, 'modules', 'coders')
  if (!existsSync(join(bin, 'magick' + EXE)) || !existsSync(coders)) return
  process.env.MAGICK_CODER_MODULE_PATH = coders
  const filters = join(bin, 'modules', 'filters')
  if (existsSync(filters)) process.env.MAGICK_CODER_FILTER_PATH = filters
  // The xml config (delegates, policy, …) sits flat in bin next to magick.exe.
  process.env.MAGICK_CONFIGURE_PATH = bin
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
    for (const root of programFilesRoots())
      for (const n of names) {
        const p = join(root, 'LibreOffice', 'program', n)
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
    for (const base of programFilesRoots().map((r) => join(r, 'gs'))) {
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

/** 7-Zip's console binary: bundled in resources/bin like ffmpeg and magick,
 * falling back to the bare name so a PATH install still works in dev. Reading
 * a rar needs nothing beyond this; only WRITING one needs WinRAR. */
export function resolveSevenZip(): string {
  return resolveTool('7z')
}

/** First `<root>/WinRAR/Rar.exe` that exists, or null. Split out from
 * resolveRar so the search itself is testable against temp fixtures instead of
 * whatever happens to be installed on the machine running the suite. */
export function findRarIn(roots: string[]): string | null {
  for (const root of roots) {
    const p = join(root, 'WinRAR', 'Rar.exe')
    if (existsSync(p)) return p
  }
  return null
}

/**
 * WinRAR's Rar.exe, the only thing that can WRITE a rar (and therefore a .cbr).
 * It is proprietary and cannot be bundled, and 7-Zip's unRAR licence forbids
 * using its RAR code to build a compressor. So this returns null when WinRAR is
 * absent and the UI greys the RAR targets out with a reason.
 */
export function resolveRar(): string | null {
  if (process.platform !== 'win32') return null
  return findRarIn(programFilesRoots())
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
// A RANGE, not an exact pin. `==2.0.75` froze the session catalogue at that
// release forever, so a newly-published matting model was unreachable even
// though rembg itself supported it. The floor keeps the numba/Python-3.13
// resolution fix that made the exact pin necessary in the first place; the
// ceiling keeps a major release from changing the CLI under us.
const REMBG_SPEC = 'rembg[cli,cpu]>=2.0.75,<3'

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
 * files — rather than failing mid-run. Async so the PATH probe counts: a uv
 * installed via scoop/choco/cargo lives only on PATH, and the fixed-path
 * lookup reported uvAvailable:false for those users. */
export async function removebgStatus(): Promise<RembgStatus> {
  return { ready: existsSync(rembgInstalledPath()), uvAvailable: (await findUvAsync()) != null }
}

export function resolveRembg(): RembgCommand | null {
  // (a) an existing uv tool install (what a returning user will have)
  const installed = rembgInstalledPath()
  if (existsSync(installed)) return { cmd: installed, prefix: [] }

  // (b) uv itself, which fetches Python + rembg on demand. A PATH-only uv
  // (scoop/choco/cargo) is used by bare name when the async status probe has
  // already confirmed one answers — resolveRembg stays synchronous.
  const uv = resolveUv() ?? (uvOnPathCached() ? 'uv' : null)
  if (uv)
    return { cmd: uv, prefix: ['tool', 'run', '--python', '3.11', '--from', REMBG_SPEC, 'rembg'] }
  return null
}

/**
 * uv, from every place it can be — including the one the app downloaded itself.
 * Delegates to src/main/uv.ts; see that file for why this used to miss the uv
 * the PiD installer had just placed at <pidRoot>/uv/uv.exe, and told the user to
 * go install one from a terminal.
 */
export function resolveUv(): string | null {
  return findUv()
}

/**
 * What to tell the user when a binary could not be started at all. Keyed on the
 * command's base name, because the resolvers hand back either a bundled path or
 * a bare PATH name. A missing bundled tool is a broken install, so every message
 * says how to get it back rather than showing `spawn gswin64c ENOENT`.
 */
const MISSING_TOOL_HELP: Record<string, string> = {
  magick: 'The image engine (ImageMagick) is missing from this installation. Reinstall Filesmith.',
  ffmpeg: 'The media engine (ffmpeg) is missing from this installation. Reinstall Filesmith.',
  ffprobe: 'The media engine (ffprobe) is missing from this installation. Reinstall Filesmith.',
  mutool: 'The PDF engine (mutool) is missing from this installation. Reinstall Filesmith.',
  caesiumclt:
    'The image compressor (CaesiumCLT) is missing from this installation. Reinstall Filesmith.',
  gswin64c:
    'PDF compression needs Ghostscript, which is missing from this installation. Reinstall Filesmith, or install Ghostscript (ghostscript.com) and restart.',
  gs: 'PDF compression needs Ghostscript, which is missing from this installation. Reinstall Filesmith, or install Ghostscript (ghostscript.com) and restart.',
  'realesrgan-ncnn-vulkan':
    'AI upscaling needs Real-ESRGAN, which is missing from this installation. Reinstall Filesmith.',
  soffice:
    'Document conversion needs LibreOffice, which is missing from this installation. Reinstall Filesmith, or install LibreOffice (winget install TheDocumentFoundation.LibreOffice) and restart.'
}

/** A user-facing message for a `ToolMissingError`'s command. */
export function toolMissingMessage(cmd: string): string {
  const base = cmd
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(exe|com)$/i, '')
  return (
    MISSING_TOOL_HELP[base] ??
    `A required tool (${base}) is missing from this installation. Reinstall Filesmith.`
  )
}
