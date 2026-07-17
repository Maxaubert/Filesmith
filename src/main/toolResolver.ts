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
