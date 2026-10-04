import { closeSync, existsSync, openSync } from 'fs'
import { basename, dirname, extname, join } from 'path'

// Collision-safe output naming. Direct port of the Get-UniqueOutPath /
// Get-UniqueOutDir logic hardened in RCMM's rcmm-convert.ps1: NEVER overwrite
// the user's source or an existing unrelated file. This is a hard rule.

/**
 * A collision-free file path (`name.ext` -> `name (tag).ext` ->
 * `name (tag 2).ext` -> ...) that ATOMICALLY claims the chosen name by creating
 * an empty placeholder (openSync 'wx' — exclusive create). Two jobs running
 * concurrently can otherwise pick the same free name before either has written
 * it (a batch of differently-named sources converting to one target format all
 * land on `name.ext`); the exclusive create makes the second job skip to the
 * next candidate. The tool that runs next overwrites the placeholder (ffmpeg
 * `-y`, magick, mutool, copyFileSync all overwrite). Callers MUST remove the
 * placeholder if the tool then fails — see the direct-write cleanup in registry.
 */
export function reserveFileInDir(dir: string, name: string, ext: string, tag: string): string {
  const e = ext.startsWith('.') ? ext : '.' + ext
  let cand = join(dir, name + e)
  let tagged = false
  let n = 2
  for (;;) {
    try {
      closeSync(openSync(cand, 'wx'))
      return cand
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      if (!tagged) {
        cand = join(dir, `${name} (${tag})${e}`)
        tagged = true
      } else {
        cand = join(dir, `${name} (${tag} ${n})${e}`)
        n++
      }
    }
  }
}

/** Atomically-reserved output with a new extension: next to the source, or in
 * `outDir` when the user chose an output folder. Collision rules are identical. */
export function reserveOutPath(
  sourcePath: string,
  ext: string,
  tag: string,
  outDir?: string
): string {
  const dir = outDir ?? dirname(sourcePath)
  const name = basename(sourcePath, extname(sourcePath))
  return reserveFileInDir(dir, name, ext, tag)
}

/** The job's output folder from `options.outDir`, or undefined for "next to
 * source". A folder that has gone missing is an error: silently writing next to
 * the source would put files where the user did not ask for them. */
export function resolveOutDir(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  if (!existsSync(value)) throw new Error(`Output folder not found: ${value}`)
  return value
}

/** Collision-free directory: `base` -> `base (2)` -> `base (3)` ... */
export function uniqueOutDir(dir: string, base: string): string {
  let cand = join(dir, base)
  let n = 2
  while (existsSync(cand)) {
    cand = join(dir, `${base} (${n})`)
    n++
  }
  return cand
}
