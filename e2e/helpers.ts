import type { Page } from 'playwright'
import { join, resolve } from 'path'
import type { JobEvent } from '../src/shared/types'

export const ROOT = resolve(__dirname, '..')
export const MAIN = join(ROOT, 'out', 'main', 'index.js')
export const BIN = join(ROOT, 'resources', 'bin')
export const MAGICK = join(BIN, 'magick.exe')
export const FFMPEG = join(BIN, 'ffmpeg.exe')
export const FFPROBE = join(BIN, 'ffprobe.exe')
export const MUTOOL = join(BIN, 'mutool.exe')

/** Env so the bundled modules-build magick finds its coder DLLs when the specs
 * call it directly (the app sets the same env for its own spawns). */
export const magickEnv = {
  ...process.env,
  MAGICK_CODER_MODULE_PATH: join(BIN, 'modules', 'coders'),
  MAGICK_CONFIGURE_PATH: BIN
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
