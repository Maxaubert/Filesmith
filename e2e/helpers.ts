import { _electron, type ElectronApplication, type Page } from 'playwright'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import type { JobEvent } from '../src/shared/types'

export const ROOT = resolve(__dirname, '..')
export const MAIN = join(ROOT, 'out', 'main', 'index.js')
export const BIN = join(ROOT, 'resources', 'bin')
export const MAGICK = join(BIN, 'magick.exe')
export const FFMPEG = join(BIN, 'ffmpeg.exe')
export const MUTOOL = join(BIN, 'mutool.exe')
export const SEVENZIP = join(BIN, '7z.exe')

/** Env so the bundled modules-build magick finds its coder DLLs when the specs
 * call it directly (the app sets the same env for its own spawns). */
export const magickEnv = {
  ...process.env,
  MAGICK_CODER_MODULE_PATH: join(BIN, 'modules', 'coders'),
  MAGICK_CONFIGURE_PATH: BIN
}

export interface MediaStream {
  codec_type: string
  codec_name: string
  width?: number
  height?: number
}

/** The streams of a media file, read from the header report `ffmpeg -i` prints
 * (no ffprobe is bundled). Stream lines are indented two spaces; file tags are
 * indented further, so a tag can never pass for a stream. */
export function mediaStreams(path: string): MediaStream[] {
  const { stderr } = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', '-i', path], {
    encoding: 'utf-8'
  })
  const lines = stderr.matchAll(/^ {2}Stream #0:\d+.*?: (Video|Audio): (\w+)(.*)$/gm)
  return [...lines].map(([, type, codec, rest]) => {
    const size = /, (\d+)x(\d+)(?=[ ,]|\r?$)/.exec(rest)
    return {
      codec_type: type.toLowerCase(),
      codec_name: codec,
      ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {})
    }
  })
}

/** Launch the built app for a spec. Every spec goes through here so the window
 * stays hidden (FILESMITH_E2E_HIDDEN): it paints for screenshots but is never
 * shown or focused, so a test run never steals focus from the desktop. */
export function launchApp(
  env: Record<string, string | undefined> = {}
): Promise<ElectronApplication> {
  return _electron.launch({
    args: [ROOT],
    env: { ...process.env, ...env, FILESMITH_E2E_HIDDEN: '1' } as Record<string, string>
  })
}

/** Run one job through the real preload bridge; resolve on its terminal event. */
export function runJob(
  page: Page,
  tool: string,
  input: string,
  options: Record<string, unknown>
): Promise<JobEvent> {
  return page.evaluate(
    ({ tool, input, options }) =>
      new Promise<JobEvent>((resolvePromise) => {
        const id = `e2e-${Math.random().toString(36).slice(2)}`
        const un = window.filesmith.onJobEvent((e) => {
          if (e.id !== id) return
          if (e.status === 'done' || e.status === 'failed' || e.status === 'canceled') {
            un()
            resolvePromise(e)
          }
        })
        void window.filesmith.runJob({
          id,
          tool: tool as never,
          input,
          options: options as never
        })
      }),
    { tool, input, options }
  )
}
