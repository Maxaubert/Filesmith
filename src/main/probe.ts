import { resolveTool } from './toolResolver'
import { run } from './run'

// ffprobe helpers. Kept out of the tool modules so both the engine (progress,
// scaling) and the IPC layer (the resolution preview) read media the same way.

export interface Dimensions {
  width: number
  height: number
}

/**
 * DISPLAY dimensions of a video's first stream. Reads the display-matrix
 * rotation and swaps W/H for ±90/270, so a portrait phone clip (stored coded
 * landscape) reports portrait — matching ffmpeg's auto-rotated encode.
 */
export async function probeDimensions(path: string): Promise<Dimensions | null> {
  try {
    const { code, stdout } = await run(resolveTool('ffprobe'), [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:stream_side_data=rotation',
      '-of',
      'default=noprint_wrappers=1',
      path
    ])
    if (code !== 0) return null
    const num = (k: string): number | null => {
      const m = new RegExp(`^${k}=(-?\\d+)`, 'm').exec(stdout)
      return m ? Number(m[1]) : null
    }
    let w = num('width')
    let h = num('height')
    const rot = num('rotation')
    if (w == null || h == null) return null
    if (rot != null && Math.abs(rot % 180) === 90) [w, h] = [h, w]
    return { width: w, height: h }
  } catch {
    return null
  }
}

/** Duration in seconds of a media file, or null. Used to turn ffmpeg's
 * `time=` output into a real percentage for long encodes. */
export async function probeDuration(path: string): Promise<number | null> {
  try {
    const { code, stdout } = await run(resolveTool('ffprobe'), [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path
    ])
    const d = code === 0 ? Number(stdout.trim()) : NaN
    return Number.isFinite(d) && d > 0 ? d : null
  } catch {
    return null
  }
}

/**
 * Build an onStderr handler that turns ffmpeg's progress lines
 * (`… time=00:01:23.45 …`) into 0-99% against a known duration. Returns
 * undefined when the duration is unknown, so the caller falls back to the
 * indeterminate bar instead of reporting a bogus number.
 */
export function ffmpegProgress(
  durationSec: number | null,
  onPercent: (pct: number) => void
): ((chunk: string) => void) | undefined {
  if (!durationSec) return undefined
  return (chunk: string) => {
    // ffmpeg reprints the status line; take the last time= in this chunk.
    let m: RegExpExecArray | null = null
    const re = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g
    for (let hit = re.exec(chunk); hit; hit = re.exec(chunk)) m = hit
    if (!m) return
    const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    // Cap at 99 so the bar only completes when the job actually finishes.
    onPercent(Math.max(0, Math.min(99, (secs / durationSec) * 100)))
  }
}
