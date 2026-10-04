import { readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { configureBundledMagickEnv } from './toolResolver'
import { ensureUserLayers } from './registry/load'

/**
 * Remove temp dirs orphaned by a previous HARD crash (normal runs delete their
 * own in a finally). Guarded by age so a concurrent app or CLI's in-use temp dir
 * is never swept out from under an active job. Best effort; never throws.
 */
export function sweepStaleTempDirs(now = Date.now(), dir = tmpdir()): void {
  try {
    const cutoff = now - 60 * 60 * 1000
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('filesmith-')) continue
      const p = join(dir, name)
      try {
        if (statSync(p).mtimeMs < cutoff) rmSync(p, { recursive: true, force: true })
      } catch {
        /* in use or already gone */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Startup shared by the app and the CLI (spec M2). The magick env is the one
 * that matters: without it every image job fails on a clean install with
 * "no decode delegate". */
export function bootEngine(): void {
  sweepStaleTempDirs()
  configureBundledMagickEnv()
  ensureUserLayers()
}
