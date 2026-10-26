import { closeSync, existsSync, openSync, rmSync, statSync, utimesSync } from 'fs'
import { basename, dirname, extname, join, resolve } from 'path'
import type { JobOptions } from '@shared/types'
import { renderOutputName } from '@shared/outputNaming'
import { renameRetrying } from './atomicOutput'
import { hasRecycleBin, tooBigForRecycleBin } from './recycle'

// What happens to a finished output before the job reports done (2026-10-26):
// Rename to the user's pattern, or Replace the original (the original goes to
// the Recycle Bin, never a permanent delete, and only after the new file is
// fully written), then optionally copy the source's dates onto it. The
// never-overwrite rule still holds for every other file: a taken name gets
// ` (2)`, ` (3)`, ...

export interface FinishOptions {
  replace: boolean
  /** The rename pattern, or null when names stay as the tool chose them. */
  rename: string | null
  keepDates: boolean
  /** 1-based position in the run, for `{n}`. */
  seq: number
}

export function finishOptions(o: JobOptions): FinishOptions {
  const replace = o.replaceOriginals === true
  const pattern = typeof o.renamePattern === 'string' ? o.renamePattern.trim() : ''
  const seq = Number(o.seq)
  return {
    replace,
    // Replace wins: the new file takes the original's name.
    rename: !replace && o.rename === true && pattern ? pattern : null,
    keepDates: o.keepDates === true,
    seq: Number.isFinite(seq) && seq >= 1 ? Math.floor(seq) : 1
  }
}

/** The tools that show these options. Elsewhere (archive routes on Convert,
 * pdf, generate) they are hidden, so a value left in the options bag from an
 * earlier target must not act. */
export const FINISH_TOOLS: readonly string[] = [
  'convert',
  'compress',
  'resize',
  'upscale',
  'removebg'
]

/** Finish options for this tool, or all-off where the tool does not offer them. */
export function finishOptionsFor(tool: string, o: JobOptions): FinishOptions {
  const fo = finishOptions(o)
  return FINISH_TOOLS.includes(tool)
    ? fo
    : { ...fo, replace: false, rename: null, keepDates: false }
}

/** Replace only makes sense for one source in, one file out: never for merge
 * (many in) or a tool without the option. Folder outputs are excluded at run time. */
export function canReplace(tool: string, options: JobOptions): boolean {
  return FINISH_TOOLS.includes(tool) && !Array.isArray(options.mergeInputs)
}

/** File names in collision order without a tag: `name.ext`, `name (2).ext`, ... */
function* plainCandidates(dir: string, name: string, ext: string): Generator<string> {
  yield join(dir, name + ext)
  for (let n = 2; ; n++) yield join(dir, `${name} (${n})${ext}`)
}

const same = (a: string, b: string): boolean =>
  resolve(a).toLowerCase() === resolve(b).toLowerCase()

/** Move `from` to the first free `name.ext` candidate in `dir`, claiming the
 * name with an exclusive create first so a concurrent job cannot take it.
 * Landing on its own current name is a no-op. */
function moveToFreeName(from: string, dir: string, name: string, ext: string): string {
  for (const cand of plainCandidates(dir, name, ext)) {
    if (same(cand, from)) return from
    try {
      closeSync(openSync(cand, 'wx'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
    try {
      renameRetrying(from, cand)
    } catch (err) {
      // Never leave an empty file under a real name (it would sit where the
      // recycled original was).
      rmSync(cand, { force: true })
      throw err
    }
    return cand
  }
  throw new Error('unreachable')
}

const stem = (p: string): string => basename(p, extname(p))

/**
 * Apply Rename / Replace / Keep dates to a finished output. `trash` sends a
 * path to the Recycle Bin. A failure to recycle the original is not a failed
 * job (the new file is fine): the original stays and `note` says why.
 */
export async function finishOutput(
  source: string,
  output: string,
  fo: FinishOptions,
  replaceAllowed: boolean,
  trash: (p: string) => Promise<void>,
  now: Date = new Date(),
  recyclable: (p: string) => Promise<boolean> = hasRecycleBin
): Promise<{ path: string; note?: string }> {
  if (!fo.replace && !fo.rename && !fo.keepDates) return { path: output }
  let out: ReturnType<typeof statSync>
  try {
    out = statSync(output)
  } catch {
    return { path: output }
  }
  if (!out.isFile()) return { path: output }
  const src = existsSync(source) ? statSync(source) : null
  let path = output
  let note: string | undefined

  if (fo.replace && replaceAllowed && src && !same(source, output)) {
    if (tooBigForRecycleBin({ bytes: src.size, files: 1 })) {
      note = 'Original kept: too large for the Recycle Bin.'
    } else if (!(await recyclable(source))) {
      // Windows deletes for good on drives without a Recycle Bin (USB sticks,
      // SD cards, network shares): never risk that.
      note = 'Original kept: this drive has no Recycle Bin.'
    } else {
      try {
        await trash(source)
      } catch (e) {
        note = `Original kept: ${(e as Error).message}`
      }
      if (!note) path = moveToFreeName(output, dirname(source), stem(source), extname(output))
    }
  } else if (fo.rename) {
    const name = renderOutputName(fo.rename, stem(source), fo.seq, now)
    path = moveToFreeName(output, dirname(output), name, extname(output))
  }

  if (fo.keepDates && src) {
    try {
      utimesSync(path, src.atime, src.mtime)
    } catch {
      /* best effort: the file itself is fine */
    }
  }
  return { path, note }
}

/** The path finishOutput WOULD end on, without touching disk (CLI dry run).
 * `planned` is the tool's predicted output; `claimed` holds lower-cased
 * paths already predicted in this run. */
export function planFinish(
  source: string,
  planned: { path: string; kind: 'file' | 'dir' },
  fo: FinishOptions,
  replaceAllowed: boolean,
  claimed: Set<string>,
  now: Date = new Date()
): string {
  if (planned.kind !== 'file') return planned.path
  let dir: string
  let name: string
  if (fo.replace && replaceAllowed && !same(source, planned.path)) {
    dir = dirname(source)
    name = stem(source)
  } else if (fo.rename) {
    dir = dirname(planned.path)
    name = renderOutputName(fo.rename, stem(source), fo.seq, now)
  } else return planned.path
  const ext = extname(planned.path)
  claimed.delete(planned.path.toLowerCase())
  for (const cand of plainCandidates(dir, name, ext)) {
    const key = cand.toLowerCase()
    // The source is about to go to the Recycle Bin, so its name counts as free.
    const free =
      (!existsSync(cand) || same(cand, planned.path) || (fo.replace && same(cand, source))) &&
      !claimed.has(key)
    if (!free) continue
    claimed.add(key)
    return cand
  }
  throw new Error('unreachable')
}
