import { resolveTool } from './toolResolver'
import { run } from './run'

// Media probing. Kept out of the tool modules so both the engine (progress,
// scaling) and the IPC layer (the resolution preview) read media the same way.
// Video and audio are read from the header report `ffmpeg -i <file>` prints, so
// the installer does not have to carry a second ~100 MB exe (ffprobe).

export interface Dimensions {
  width: number
  height: number
}

/**
 * The report on the opened input, or null when ffmpeg could not open it.
 * Everything matched in it is anchored to its indentation: file tags are echoed
 * in the same report (indented four spaces or more, continuation lines
 * included), and a tag may well contain "Duration:" or "Stream #0:0: Video:".
 */
function inputReport(stderr: string): string | null {
  const text = stderr.replace(/\r\n?/g, '\n')
  const start = text.search(/^Input #0, /m)
  return start < 0 ? null : text.slice(start)
}

/** Container duration in seconds from an `ffmpeg -i` report; null for N/A. */
export function parseDuration(stderr: string): number | null {
  const m = /^ {2}Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/m.exec(inputReport(stderr) ?? '')
  if (!m) return null
  const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  return secs > 0 ? secs : null
}

/**
 * DISPLAY dimensions of the first video stream in an `ffmpeg -i` report. Reads
 * the display-matrix rotation and swaps W/H for ±90/270, so a portrait phone
 * clip (stored coded landscape) reports portrait, matching ffmpeg's
 * auto-rotated encode.
 */
export function parseDimensions(stderr: string): Dimensions | null {
  const report = inputReport(stderr)
  if (!report) return null
  const stream = /^ {2,4}Stream #0:\d+[^\n]*?: Video: ([^\n]*)$/m.exec(report)
  if (!stream) return null
  // ", 1920x1080" followed by a space, comma or the end. The codec tag
  // (`avc1 / 0x31637661`) also looks like NxN but never follows ", ".
  const size = /, (\d+)x(\d+)(?=[ ,]|$)/.exec(stream[1])
  if (!size) return null
  let width = Number(size[1])
  let height = Number(size[2])
  if (!width || !height) return null
  // This stream's own block ends at the next stream.
  const after = report.slice(stream.index + stream[0].length)
  const next = after.search(/^ {2,4}Stream #/m)
  const block = next < 0 ? after : after.slice(0, next)
  const rot = /^ +(?:Display Matrix|displaymatrix): rotation of (-?[\d.]+) degrees/m.exec(block)
  if (rot && Math.abs(Math.round(Number(rot[1])) % 180) === 90) [width, height] = [height, width]
  return { width, height }
}

/** The header report for a file. ffmpeg exits non-zero here because no output
 * is named, so the exit code says nothing: the parsers decide. */
async function mediaReport(path: string): Promise<string> {
  const { stderr } = await run(resolveTool('ffmpeg'), ['-hide_banner', '-nostdin', '-i', path])
  return stderr
}

/** DISPLAY dimensions of a video's first stream (see parseDimensions). */
export async function probeDimensions(path: string): Promise<Dimensions | null> {
  try {
    return parseDimensions(await mediaReport(path))
  } catch {
    return null
  }
}

/**
 * Pixel dimensions of an IMAGE, via ImageMagick rather than ffmpeg.
 * ffmpeg's probe is wrong for this job in both directions: it rejects very large images
 * outright ("Picture size 24000x16000 is invalid"), which is exactly the case
 * the upscale size warning exists for, and it can't read svg/jxl/heic at all.
 *
 * `-ping` is load-bearing, not a micro-optimization: without it ImageMagick
 * decodes the whole image, which took 9 SECONDS on a 384 MP PNG. The size
 * preview sat on "…" that entire time and the oversize warning never fired,
 * because the UI had no dimensions to warn about. With -ping it's 0.03s.
 * Multi-frame sources (.ico, .gif) print one line per frame, so take the first.
 */
export async function probeImageDimensions(path: string): Promise<Dimensions | null> {
  try {
    const { code, stdout } = await run(resolveTool('magick'), [
      'identify',
      '-ping',
      '-format',
      '%w %h\n',
      path
    ])
    const m = /^(\d+) (\d+)/.exec(stdout.trim())
    if (code !== 0 || !m) return null
    return { width: Number(m[1]), height: Number(m[2]) }
  } catch {
    return null
  }
}

/** Duration in seconds of a media file, or null. Used to turn ffmpeg's
 * `time=` output into a real percentage for long encodes. */
export async function probeDuration(path: string): Promise<number | null> {
  try {
    return parseDuration(await mediaReport(path))
  } catch {
    return null
  }
}

/**
 * Build an onStderr handler that turns ffmpeg's progress lines
 * (`… time=00:01:23.45 … speed=1.87x`) into a 0-99% figure against a known
 * duration, plus a seconds-remaining estimate derived from ffmpeg's own speed
 * multiplier. Returns undefined when the duration is unknown, so the caller
 * falls back to the indeterminate bar instead of reporting a bogus number.
 *
 * The ETA matters as much as the percentage here: a 2-hour movie spends
 * minutes below 1%, which reads as "stuck" without a time remaining.
 */
export function ffmpegProgress(
  durationSec: number | null,
  onProgress: (pct: number, etaSec: number | null) => void
): ((chunk: string) => void) | undefined {
  if (!durationSec) return undefined
  return (chunk: string) => {
    // ffmpeg reprints the status line; take the last time= in this chunk.
    let m: RegExpExecArray | null = null
    const re = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g
    for (let hit = re.exec(chunk); hit; hit = re.exec(chunk)) m = hit
    if (!m) return
    const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    let speed: number | null = null
    const sre = /speed=\s*([\d.]+)x/g
    for (let hit = sre.exec(chunk); hit; hit = sre.exec(chunk)) speed = Number(hit[1])
    const eta = speed && speed > 0 ? Math.max(0, (durationSec - secs) / speed) : null
    // Cap at 99 so the bar only completes when the job actually finishes.
    onProgress(Math.max(0, Math.min(99, (secs / durationSec) * 100)), eta)
  }
}
