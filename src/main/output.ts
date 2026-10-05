import { closeSync, existsSync, openSync } from 'fs'
import { basename, dirname, extname, join } from 'path'

// Collision-safe output naming. Direct port of the Get-UniqueOutPath /
// Get-UniqueOutDir logic hardened in RCMM's rcmm-convert.ps1: NEVER overwrite
// the user's source or an existing unrelated file. This is a hard rule.

/** Candidate names in collision order: `name.ext`, `name (tag).ext`,
 * `name (tag 2).ext`, ... One generator for the real reservation and the
 * dry-run prediction, so the two cannot drift. */
function* fileCandidates(dir: string, name: string, ext: string, tag: string): Generator<string> {
  const e = ext.startsWith('.') ? ext : '.' + ext
  yield join(dir, name + e)
  yield join(dir, `${name} (${tag})${e}`)
  for (let n = 2; ; n++) yield join(dir, `${name} (${tag} ${n})${e}`)
}

/** Folder names in collision order: `base`, `base (2)`, `base (3)`, ... */
export function* dirCandidates(dir: string, base: string): Generator<string> {
  yield join(dir, base)
  for (let n = 2; ; n++) yield join(dir, `${base} (${n})`)
}

/**
 * A collision-free file path that ATOMICALLY claims the chosen name by creating
 * an empty placeholder (openSync 'wx', exclusive create). Two jobs running
 * concurrently can otherwise pick the same free name before either has written
 * it; the exclusive create makes the second job skip to the next candidate. The
 * tool that runs next overwrites the placeholder. Callers MUST remove the
 * placeholder if the tool then fails (see the direct-write cleanup in registry).
 */
export function reserveFileInDir(dir: string, name: string, ext: string, tag: string): string {
  for (const cand of fileCandidates(dir, name, ext, tag)) {
    try {
      closeSync(openSync(cand, 'wx'))
      return cand
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  throw new Error('unreachable')
}

/** The name reserveFileInDir WOULD pick, without creating anything (dry run).
 * `claimed` holds lower-cased paths predicted earlier in the same run, so two
 * sources that land on one name are predicted as the real run will name them.
 * A prediction: another process may take a name before the real run. */
export function planFileInDir(
  dir: string,
  name: string,
  ext: string,
  tag: string,
  claimed: Set<string> = new Set()
): string {
  for (const cand of fileCandidates(dir, name, ext, tag)) {
    if (existsSync(cand) || claimed.has(cand.toLowerCase())) continue
    claimed.add(cand.toLowerCase())
    return cand
  }
  throw new Error('unreachable')
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
  for (const cand of dirCandidates(dir, base)) if (!existsSync(cand)) return cand
  throw new Error('unreachable')
}

/** The folder uniqueOutDir WOULD pick, honouring earlier claims in the run. */
export function planOutDir(dir: string, base: string, claimed: Set<string> = new Set()): string {
  for (const cand of dirCandidates(dir, base)) {
    if (existsSync(cand) || claimed.has(cand.toLowerCase())) continue
    claimed.add(cand.toLowerCase())
    return cand
  }
  throw new Error('unreachable')
}
