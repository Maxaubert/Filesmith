import { existsSync } from 'fs'
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
