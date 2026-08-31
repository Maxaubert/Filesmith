import type { ArchiveContainer } from '@shared/archive'

// Archive operations via 7-Zip (extract + pack) and, when installed, WinRAR
// (pack only: nothing else can write RAR). Every function here is pure so the
// argument shapes are testable without spawning anything, matching how
// convert.ts and pdf.ts are structured.

/** Image entries treated as comic pages when converting an archive to PDF. */
export const IMAGE_ENTRY_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff']

/** `7z x <in> -o<dir> -y -bsp2` — extract everything, overwriting inside our own
 * temp dir. `-bsp2` puts the progress stream on stderr, where run.ts already
 * listens, so no change to the spawn helper is needed. */
export function buildExtractArgs(input: string, outDir: string): string[] {
  return ['x', input, '-o' + outDir, '-y', '-bsp2']
}

/**
 * `7z a -t<container> -mx<n> <out> * -y -bsp2` — pack the CURRENT DIRECTORY's
 * contents. Run this with cwd set to the extracted temp dir: passing the dir
 * path instead would nest everything under a wrapper folder, which comic
 * readers show as an empty book. 7-Zip expands `*` itself, so no shell is
 * involved and the no-shell spawn rule still holds.
 *
 * `store` (-mx0) is the default for comic archives: the pages are already
 * compressed images, so deflate costs time and saves nothing.
 */
export function buildPackArgs(
  output: string,
  container: ArchiveContainer,
  store: boolean
): string[] {
  return ['a', '-t' + container, store ? '-mx0' : '-mx5', output, '*', '-y', '-bsp2']
}

/** `rar a -ep1 -r -y <out> .` — WinRAR packing the cwd. `-ep1` strips the base
 * path so entries are not prefixed with `./`. */
export function buildRarPackArgs(output: string): string[] {
  return ['a', '-ep1', '-r', '-y', output, '.']
}

/** Last percent counter in a 7-Zip progress chunk, clamped to 0..100. */
export function parse7zProgress(chunk: string): number | undefined {
  const matches = [...chunk.matchAll(/(\d{1,3})%/g)]
  if (matches.length === 0) return undefined
  const n = Number(matches[matches.length - 1][1])
  return Math.max(0, Math.min(100, n))
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Sort entry names the way a reader expects pages: page2 before page10. Plain
 * lexicographic order scrambles every comic with more than nine pages, which is
 * the whole point of this feature. */
export function naturalSort(names: string[]): string[] {
  return [...names].sort((a, b) => collator.compare(a, b))
}

/**
 * Split an image list into groups whose joined command line stays under
 * `budget` characters. Windows caps a command line at 32767 and a 400-page
 * comic blows past it. A single path longer than the budget still gets its own
 * batch rather than being dropped.
 */
export function batchImages(paths: string[], budget: number): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let len = 0
  for (const p of paths) {
    const add = current.length === 0 ? p.length : p.length + 1
    if (current.length > 0 && len + add > budget) {
      batches.push(current)
      current = []
      len = 0
    }
    len += current.length === 0 ? p.length : p.length + 1
    current.push(p)
  }
  if (current.length > 0) batches.push(current)
  return batches
}
