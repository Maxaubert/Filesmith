import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { nativeImage } from 'electron'
import type { FileKind } from '@shared/types'
import { resolveTool } from './toolResolver'
import { run } from './run'
import { magickFrame } from './tools/convert'

/**
 * Best-effort thumbnail for a file, returned as a PNG data URL (or null).
 *
 * Layered so we cover as many types as possible using the tools we bundle:
 *  1. The OS shell thumbnail provider — fast and cached; handles common images,
 *     .ico, PDFs, and many videos via installed handlers.
 *  2. Fallback by kind for what the OS can't render:
 *       image → ImageMagick (HEIC/AVIF/JXL/SVG/TGA/XCF/… the shell won't do)
 *       video → an ffmpeg frame grab
 *       audio → ffmpeg-extracted embedded cover art
 * Files with no visual (e.g. art-less audio) return null and the UI shows the
 * file's extension badge instead.
 *
 * `fit` 'cover' is for square cards that crop (object-fit: cover): the SHORT
 * side must reach `size`, else a 3:2 photo or a 16:9 video comes out soft.
 * 'contain' (the default) fits the long side, as the preview pane wants.
 */
export type ThumbFit = 'contain' | 'cover'

export async function makeThumbnail(
  path: string,
  size: number,
  kind: FileKind,
  fit: ThumbFit = 'contain'
): Promise<string | null> {
  // The WHOLE pipeline runs under the limiter: osThumbnail was previously
  // uncapped, so dropping hundreds of files fired hundreds of concurrent
  // shell-thumbnail requests in one pass.
  return withLimit(async () => {
    const os = await osThumbnail(path, size)
    if (os && !osTooSmall(os, size, kind, fit)) return os.url
    const tool = await toolThumbnail(path, size, kind, fit)
    // A tool result only wins when it really is bigger (a small source gives
    // the same size either way); a failed tool keeps the OS one.
    if (!os) return tool?.url ?? null
    return tool && side(tool, fit) > side(os, fit) ? tool.url : os.url
  })
}

export interface Dims {
  width: number
  height: number
}
interface Thumb extends Dims {
  url: string
}

/** The side that has to reach the request: the long one to contain, the short one to cover. */
const side = (d: Dims, fit: ThumbFit): number =>
  fit === 'cover' ? Math.min(d.width, d.height) : Math.max(d.width, d.height)

/**
 * Whether an OS shell thumbnail is too small for the request, so the tool path
 * should try: the Windows provider often caps at 256px whatever is asked, and
 * always fits the long side. Only requests above the 128px every item gets,
 * and kinds a bundled tool can render, qualify, so the common small request
 * stays as cheap as before. Within 2px counts as a hit (rounding); `source`,
 * when known, caps the expectation, since a thumbnail never upscales.
 */
export function osTooSmall(
  os: Dims,
  requested: number,
  kind: FileKind,
  fit: ThumbFit = 'contain',
  source?: Dims
): boolean {
  if (requested <= 128) return false
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return false
  const want = source ? Math.min(requested, side(source, fit)) : requested
  return side(os, fit) < want - 2
}

async function osThumbnail(path: string, size: number): Promise<Thumb | null> {
  try {
    const img = await nativeImage.createThumbnailFromPath(path, { width: size, height: size })
    if (img.isEmpty()) return null
    return { url: img.toDataURL(), ...img.getSize() }
  } catch {
    return null
  }
}

async function toolThumbnail(
  path: string,
  size: number,
  kind: FileKind,
  fit: ThumbFit
): Promise<Thumb | null> {
  const url =
    kind === 'image'
      ? await magickThumbnail(path, size, fit)
      : kind === 'video'
        ? await videoFrame(path, size, fit)
        : kind === 'audio'
          ? await audioCover(path, size, fit)
          : null
  if (!url) return null
  return { url, ...nativeImage.createFromDataURL(url).getSize() }
}

/** ffmpeg scale to `size` without ever upscaling or distorting: contain fits
 * the long side, cover the short one (the UI crops). The quotes keep the
 * commas inside min() from splitting the filtergraph. */
export const scale = (size: number, fit: ThumbFit = 'contain'): string =>
  `scale='min(${size},iw)':'min(${size},ih)':force_original_aspect_ratio=${
    fit === 'cover' ? 'increase' : 'decrease'
  }`

/** ImageMagick geometry: `^` fills (cover), `>` only ever shrinks. */
export const magickGeometry = (size: number, fit: ThumbFit = 'contain'): string =>
  `${size}x${size}${fit === 'cover' ? '^' : ''}>`

/** ImageMagick can decode formats the shell can't; [0] takes the first frame/page. */
function magickThumbnail(path: string, size: number, fit: ThumbFit): Promise<string | null> {
  return toolPng('magick', [magickFrame(path), '-thumbnail', magickGeometry(size, fit)])
}

/** A representative video frame: seek ~1s to skip black lead-in, else frame 0. */
async function videoFrame(path: string, size: number, fit: ThumbFit): Promise<string | null> {
  const at = (seek: string[]): string[] => [
    '-y',
    '-loglevel',
    'error',
    ...seek,
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    scale(size, fit)
  ]
  return (await toolPng('ffmpeg', at(['-ss', '1']))) ?? toolPng('ffmpeg', at([]))
}

/** Embedded cover art (an attached picture stream), if the audio file has one. */
function audioCover(path: string, size: number, fit: ThumbFit): Promise<string | null> {
  return toolPng('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    path,
    '-map',
    '0:v?',
    '-frames:v',
    '1',
    '-vf',
    scale(size, fit)
  ])
}

/** Run a tool that writes one PNG (appended as the last arg); return a data URL. */
async function toolPng(tool: string, args: string[]): Promise<string | null> {
  // `filesmith-` prefix so the stale-temp sweeper (index.ts) collects it if a
  // hard crash skips the finally cleanup.
  const out = join(tmpdir(), `filesmith-thumb-${randomUUID()}.png`)
  // A watchdog, because this work has no user-visible failure mode: an ffmpeg
  // hung on a disconnected network share would otherwise hold a limiter slot
  // forever and park every later thumbnail behind it.
  const ac = new AbortController()
  const watchdog = setTimeout(() => ac.abort(), 20_000)
  watchdog.unref?.()
  try {
    const { code } = await run(resolveTool(tool), [...args, out], { signal: ac.signal })
    if (code !== 0 || !existsSync(out)) return null
    return `data:image/png;base64,${readFileSync(out).toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(watchdog)
    rmSync(out, { force: true })
  }
}

// Cap concurrent tool spawns so dropping many videos/audio at once doesn't
// flood the machine with ffmpeg/magick processes (and starve real jobs).
let active = 0
const waiters: Array<() => void> = []
async function withLimit<T>(fn: () => Promise<T>, max = 3): Promise<T> {
  if (active >= max) await new Promise<void>((resolve) => waiters.push(resolve))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiters.shift()?.()
  }
}
