import { _electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { JobEvent } from '../src/shared/types'

// Smoke the real app end to end: launch the built Electron bundle, run a job
// through the actual preload bridge -> IPC -> engine -> bundled binary, and
// assert the collision-safe output landed. This is the coverage the unit
// suite structurally cannot have (a renamed IPC channel, a broken preload
// bridge, or a mis-bundled binary all pass unit tests and fail here).

const ROOT = resolve(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const MAGICK = join(ROOT, 'resources', 'bin', 'magick.exe')
const FFMPEG = join(ROOT, 'resources', 'bin', 'ffmpeg.exe')

// A tiny valid PNG (1x1 white).
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

// The bundled binaries are fetched, not committed; without them (a bare CI
// checkout) the engine specs cannot mean anything.
const binariesPresent = existsSync(MAGICK) && existsSync(FFMPEG)

let app: ElectronApplication
let page: Page
let dir: string

test.beforeAll(async () => {
  test.skip(!existsSync(MAIN), 'run `npm run build` first')
  dir = mkdtempSync(join(tmpdir(), 'filesmith-e2e-'))
  // Launch by PACKAGE ROOT, not the main script: `electron out/main/index.js`
  // makes app.getAppPath() resolve to out/main, which silently hides every
  // resources/ tree and lets resolveTool fall back to PATH binaries — the
  // suite would then test the machine's tools, not the bundled ones.
  app = await _electron.launch({ args: [ROOT] })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Run one job through the real bridge and wait for its terminal event. */
function runJob(tool: string, input: string, options: Record<string, unknown>): Promise<JobEvent> {
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

test('the app boots to the Images workspace', async () => {
  await expect(page.locator('text=Images').first()).toBeVisible()
  // The primary action is on screen without scrolling (the pinned footer).
  await expect(page.locator('button', { hasText: 'Convert' }).last()).toBeVisible()
})

test('convert PNG -> JPG lands a collision-safe output', async () => {
  test.skip(!binariesPresent, 'bundled binaries not fetched')
  const src = join(dir, 'photo.png')
  writeFileSync(src, PNG_1PX)
  const e = await runJob('convert', src, { format: '.jpg', quality: 'balanced' })
  expect(e.status).toBe('done')
  expect(e.outputPath).toBe(join(dir, 'photo.jpg'))
  expect(existsSync(e.outputPath!)).toBe(true)
})

test('a % in the filename neither fails the job nor touches a neighbour', async () => {
  test.skip(!binariesPresent, 'bundled binaries not fetched')
  const src = join(dir, '100%off.png')
  const bystander = join(dir, '1000ff (converted).jpg')
  writeFileSync(src, PNG_1PX)
  writeFileSync(bystander, 'bystander bytes')
  const e = await runJob('convert', src, { format: '.jpg', quality: 'balanced' })
  expect(e.status).toBe('done')
  expect(existsSync(e.outputPath!)).toBe(true)
  // The unrelated file with the lookalike printf-expanded name is untouched.
  const fs = await import('fs')
  expect(fs.readFileSync(bystander, 'utf-8')).toBe('bystander bytes')
})

test('cancel stops a running encode and reports canceled', async () => {
  test.skip(!binariesPresent, 'bundled binaries not fetched')
  // A clip long enough that an AV1 encode cannot finish before the cancel.
  const clip = join(dir, 'clip.mp4')
  execFileSync(FFMPEG, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=20:size=1280x720:rate=30',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    clip
  ])
  const e = await page.evaluate(
    (input) =>
      new Promise<JobEvent>((resolvePromise) => {
        const id = 'e2e-cancel'
        const un = window.filesmith.onJobEvent((ev) => {
          if (ev.id !== id) return
          if (ev.status === 'running') void window.filesmith.cancelJob(id)
          if (ev.status === 'done' || ev.status === 'failed' || ev.status === 'canceled') {
            un()
            resolvePromise(ev)
          }
        })
        void window.filesmith.runJob({
          id,
          tool: 'compress',
          input,
          options: { videoCodec: 'av1', quality: 80, scale: 100 }
        })
      }),
    clip
  )
  expect(e.status).toBe('canceled')
  // No partial output was left behind next to the source.
  const leftovers = readdirSync(dir).filter((f) => f.includes('(compressed)'))
  expect(leftovers).toEqual([])
})
