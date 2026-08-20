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
 */
export async function makeThumbnail(
  path: string,
  size: number,
  kind: FileKind
): Promise<string | null> {
  // The WHOLE pipeline runs under the limiter: osThumbnail was previously
  // uncapped, so dropping hundreds of files fired hundreds of concurrent
  // shell-thumbnail requests in one pass.
  return withLimit(async () => {
    const os = await osThumbnail(path, size)
    if (os) return os
    if (kind === 'image') return magickThumbnail(path, size)
    if (kind === 'video') return videoFrame(path, size)
    if (kind === 'audio') return audioCover(path, size)
    return null
  })
}

async function osThumbnail(path: string, size: number): Promise<string | null> {
  try {
    const img = await nativeImage.createThumbnailFromPath(path, { width: size, height: size })
    return img.isEmpty() ? null : img.toDataURL()
  } catch {
    return null
  }
}

// Fit within size×size without upscaling or distorting; the UI crops via
// object-cover, so a non-square result is fine.
const scale = (size: number): string => `scale=${size}:${size}:force_original_aspect_ratio=decrease`

/** ImageMagick can decode formats the shell can't; [0] takes the first frame/page. */
function magickThumbnail(path: string, size: number): Promise<string | null> {
  return toolPng('magick', [magickFrame(path), '-thumbnail', `${size}x${size}`])
}

/** A representative video frame: seek ~1s to skip black lead-in, else frame 0. */
async function videoFrame(path: string, size: number): Promise<string | null> {
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
    scale(size)
  ]
  return (await toolPng('ffmpeg', at(['-ss', '1']))) ?? toolPng('ffmpeg', at([]))
}

/** Embedded cover art (an attached picture stream), if the audio file has one. */
function audioCover(path: string, size: number): Promise<string | null> {
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
    scale(size)
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
