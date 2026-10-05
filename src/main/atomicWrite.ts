import { mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/**
 * Write-then-rename, with a temp name unique to this process. The app and the
 * CLI can now write the same small state files (comfy-upscalers.json,
 * integrity.json) at the same time; a fixed `.part` name let one process rename
 * the other's half-written temp file into place.
 */
export function writeFileAtomic(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}
