import { test, expect } from '@playwright/test'
import { _electron } from 'playwright'
import { execFileSync, spawn, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { FFMPEG, MAGICK, MUTOOL, ROOT, magickEnv } from './helpers'

// The CLI as a real process (spec 8.2): `node out/main/cli.js` against the
// repo's bundled tools, with an isolated userData. Run `npm run build` first.
const CLI = join(ROOT, 'out', 'main', 'cli.js')
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const VERSION = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string }
).version

test.skip(!existsSync(CLI), 'run `npm run build` first')
test.skip(!existsSync(MAGICK), 'bundled tools missing (npm run binaries)')

let work: string
test.beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'fs-cli-'))
})
test.afterEach(() => rmSync(work, { recursive: true, force: true }))

type Ev = Record<string, unknown> & { event: string }
function cli(args: string[], opts: { input?: string } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: work,
    input: opts.input ?? '',
    encoding: 'utf-8',
    env: { ...process.env, FILESMITH_USER_DATA: join(work, '.ud'), NO_COLOR: '1' },
    timeout: 120_000
  })
  const events = r.stdout
    .split('\n')
    .filter((l) => l.startsWith('{')) // human-mode runs print text, not events
    .map((l) => JSON.parse(l) as Ev)
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, events }
}
const image = (name: string, size = '64x48'): string => {
  const p = join(work, name)
  mkdirSync(dirname(p), { recursive: true })
  execFileSync(MAGICK, ['-size', size, 'xc:red', p], { env: magickEnv })
  return p
}
const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')
const of = (events: Ev[], name: string): Ev[] => events.filter((e) => e.event === name)

test('png to webp with --json: pure NDJSON, output next to the source', () => {
  image('a.png')
  const r = cli(['convert', 'a.png', '--to', 'webp', '--json'])
  expect(r.code).toBe(0)
  expect(r.stderr).toBe('')
  expect(r.events.every((e) => e.v === 1 && typeof e.ts === 'string')).toBe(true)
  expect(r.events[0]).toMatchObject({ event: 'run', command: 'convert', version: VERSION })
  const done = of(r.events, 'done')[0]
  expect(done).toMatchObject({
    input: join(work, 'a.png'),
    output: join(work, 'a.webp'),
    outputKind: 'file'
  })
  expect(done.outSize as number).toBeGreaterThan(0)
  expect(r.events.at(-1)).toMatchObject({ event: 'summary', ok: 1, exitCode: 0 })
})

test('never overwrites: a second run picks the tagged name, the first output is untouched', () => {
  image('a.png')
  cli(['convert', 'a.png', '--to', 'webp'])
  const first = sha(join(work, 'a.webp'))
  const r = cli(['convert', 'a.png', '--to', 'webp', '--json'])
  expect(of(r.events, 'done')[0].output).toBe(join(work, 'a (converted).webp'))
  expect(sha(join(work, 'a.webp'))).toBe(first)
})

test('a dry run writes nothing and predicts the real names, including a shared stem', () => {
  image('photo.png')
  image('photo.jpg')
  // The isolated userData (.ud) lives in `work` too; the engine boot seeds its
  // registry folders, which is not an output of the run.
  const listing = (): string[] =>
    readdirSync(work)
      .filter((n) => n !== '.ud')
      .sort()
  const before = listing()
  const dry = cli(['convert', 'photo.png', 'photo.jpg', '--to', 'webp', '--dry-run', '--json'])
  expect(listing()).toEqual(before)
  const planned = of(dry.events, 'plan').map((e) => e.output as string)
  expect(planned).toEqual([join(work, 'photo.webp'), join(work, 'photo (converted).webp')])
  const real = cli(['convert', 'photo.png', 'photo.jpg', '--to', 'webp', '--json'])
  // Same SET of names; which input gets the untagged one depends on which
  // parallel job reserves first (spec 2.4), so the id mapping is not compared.
  expect(
    of(real.events, 'done')
      .map((e) => e.output as string)
      .sort()
  ).toEqual([...planned].sort())
})

test('a bad flag is exit 2 and writes nothing', () => {
  image('a.png')
  const r = cli(['convert', 'a.png', '--to', 'webp', '--bogus'])
  expect(r.code).toBe(2)
  expect(r.stderr).toContain('Unknown option --bogus')
  expect(existsSync(join(work, 'a.webp'))).toBe(false)
})

test('one corrupt input among good ones: exit 1, one error, the rest done', () => {
  image('good.png')
  writeFileSync(join(work, 'bad.png'), 'not an image')
  const r = cli(['convert', 'good.png', 'bad.png', '--to', 'webp', '--json'])
  expect(r.code).toBe(1)
  expect(of(r.events, 'error').map((e) => e.input)).toEqual([join(work, 'bad.png')])
  expect(of(r.events, 'done')).toHaveLength(1)
})

test('compress and resize produce real files', () => {
  image('a.jpg', '200x100')
  image('b.png', '64x48')
  expect(cli(['compress', 'a.jpg', '--quality', '50']).code).toBe(0)
  const r = cli(['resize', 'b.png', '--percent', '50', '--json'])
  const out = of(r.events, 'done')[0].output as string
  expect(
    execFileSync(MAGICK, ['identify', '-format', '%wx%h', out], { env: magickEnv }).toString()
  ).toBe('32x24')
})

test('--out: a missing folder is created; a file is exit 2 OUT_DIR_MISSING', () => {
  image('a.png')
  expect(cli(['convert', 'a.png', '--to', 'webp', '-o', 'out\\deep']).code).toBe(0)
  expect(existsSync(join(work, 'out', 'deep', 'a.webp'))).toBe(true)
  writeFileSync(join(work, 'afile'), 'x')
  const r = cli(['convert', 'a.png', '--to', 'webp', '--out', 'afile', '--json'])
  expect(r.code).toBe(2)
  expect(of(r.events, 'error')[0]).toMatchObject({ code: 'OUT_DIR_MISSING' })
  // A folder that cannot be created (under a file): the dry run ends like the
  // real run, exit 2 before any job, nothing written (spec 2.4).
  for (const extra of [['--dry-run'], []]) {
    const u = cli(['convert', 'a.png', '--to', 'webp', '--out', 'afile\\sub', '--json', ...extra])
    expect(u.code).toBe(2)
    expect(u.events.map((e) => [e.event, e.code ?? e.exitCode])).toEqual([
      ['error', 'OUT_DIR_MISSING'],
      ['summary', 2]
    ])
  }
  expect(existsSync(join(work, 'a.webp'))).toBe(false)
})

test('folder, --recursive and stdin inputs', () => {
  image('pics\\a.png')
  image('pics\\sub\\b.png')
  writeFileSync(join(work, 'pics', 'notes.txt'), 'x')
  const flat = cli(['resize', 'pics', '--percent', '50', '--dry-run', '--json'])
  expect(of(flat.events, 'plan')).toHaveLength(1)
  expect(of(flat.events, 'skipped')[0]).toMatchObject({ code: 'UNSUPPORTED_KIND' })
  expect(
    of(
      cli(['resize', 'pics', '--recursive', '--percent', '50', '--dry-run', '--json']).events,
      'plan'
    )
  ).toHaveLength(2)
  const piped = cli(['resize', '-', '--percent', '50', '--dry-run', '--json'], {
    input: 'pics\\a.png\npics\\sub\\b.png\n'
  })
  expect(of(piped.events, 'plan')).toHaveLength(2)
})

test('removebg without setup: exit 2 SETUP_REQUIRED with the exact command, nothing downloaded', () => {
  image('a.png')
  const r = cli(['removebg', 'a.png', '--json'])
  expect(r.code).toBe(2)
  expect(of(r.events, 'error')[0]).toMatchObject({
    code: 'SETUP_REQUIRED',
    hint: 'filesmith setup removebg'
  })
  expect(existsSync(join(work, '.ud', 'models', 'rembg'))).toBe(false)
})

test('runs under Electron in Node mode (the installed runtime)', () => {
  const r = spawnSync(ELECTRON, [CLI, '--version'], {
    encoding: 'utf-8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  expect(r.stdout.trim()).toBe(VERSION)
})

test('the built CLI and every chunk it loads never require electron', () => {
  const seen = new Set<string>()
  const walk = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    const src = readFileSync(file, 'utf-8')
    expect(src, file).not.toMatch(/require\(["']electron["']\)/)
    for (const m of src.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g))
      walk(join(dirname(file), m[1]))
  }
  walk(CLI)
  expect(seen.size).toBeGreaterThan(1)
})

const UPSCALER = 'realesrgan-ncnn-vulkan.exe'
function upscalerPids(): Set<string> {
  const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${UPSCALER}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf-8'
  })
  return new Set(
    out
      .split(/\r?\n/)
      .filter((l) => l.startsWith(`"${UPSCALER}"`))
      .map((l) => l.split('","')[1])
  )
}

test('a closed stdout cancels the run and exits 130 without a stack trace', async () => {
  for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) image(`${n}.png`, '1600x1200')
  const before = upscalerPids()
  const child = spawn(process.execPath, [CLI, 'upscale', '.', '--factor', '2', '--json'], {
    cwd: work,
    env: { ...process.env, FILESMITH_USER_DATA: join(work, '.ud') }
  })
  let err = ''
  child.stderr.on('data', (d) => (err += d))
  await new Promise<void>((res) => child.stdout.once('data', () => res()))
  child.stdout.destroy()
  const code = await new Promise<number | null>((res) => child.on('exit', res))
  expect(code).toBe(130)
  expect(err).not.toMatch(/at .*\.js:\d+/)
  // No orphaned tool process: every upscaler this run started is gone after
  // a short grace period.
  let orphans: string[] = []
  for (let i = 0; i < 20; i++) {
    orphans = [...upscalerPids()].filter((pid) => !before.has(pid))
    if (!orphans.length) break
    await new Promise((r) => setTimeout(r, 250))
  }
  expect(orphans).toEqual([])
})

function ffmpegPids(): Set<string> {
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq ffmpeg.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf-8'
  })
  return new Set(
    out
      .split(/\r?\n/)
      .filter((l) => l.startsWith('"ffmpeg.exe"'))
      .map((l) => l.split('","')[1])
  )
}

// Ctrl+Break, closing the console window or a hard kill end the CLI at once,
// before any JavaScript runs. Atomic outputs keep the final name clean; the
// watchdog (src/cli/watchdog.ts, armed under the Electron runtime) then stops
// the ffmpeg the dead CLI left running and removes the part file and the
// empty placeholder.
test('a CLI killed outright leaves no partial output and no ffmpeg (watchdog)', async () => {
  const video = join(work, 'long video.mp4')
  execFileSync(FFMPEG, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1920x1080:rate=30:duration=40',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    video
  ])
  const before = ffmpegPids()
  const child = spawn(ELECTRON, [CLI, 'compress', video, '--codec', 'h265', '--json'], {
    cwd: work,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FILESMITH_USER_DATA: join(work, '.ud') }
  })
  child.stdout.resume()
  child.stderr.resume()
  const part = join(work, 'long video (compressed).filesmith-part.mp4')
  for (let i = 0; i < 300 && !(existsSync(part) && statSync(part).size > 0); i++)
    await new Promise((r) => setTimeout(r, 100))
  expect(statSync(part).size).toBeGreaterThan(0)
  expect(existsSync(join(work, 'long video (compressed).mp4'))).toBe(true) // the placeholder
  // TerminateProcess on the CLI alone: its ffmpeg child keeps running.
  execFileSync('taskkill', ['/PID', String(child.pid), '/F'])
  let left: string[] = []
  let orphans: string[] = []
  for (let i = 0; i < 60; i++) {
    left = readdirSync(work).filter((f) => f !== '.ud')
    orphans = [...ffmpegPids()].filter((pid) => !before.has(pid))
    if (left.length === 1 && !orphans.length) break
    await new Promise((r) => setTimeout(r, 250))
  }
  expect(orphans).toEqual([])
  expect(left).toEqual(['long video.mp4'])
})

test('works while the app is open, and its jobs never reach the app', async () => {
  const ud = join(work, '.ud')
  const app = await _electron.launch({
    args: [ROOT],
    env: { ...process.env, FILESMITH_USER_DATA: ud }
  })
  try {
    const page = await app.firstWindow()
    image('cliprobe.png')
    const r = cli(['convert', 'cliprobe.png', '--to', 'webp', '--json'])
    expect(r.code).toBe(0)
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('cliprobe')
    expect(app.windows()).toHaveLength(1)
  } finally {
    await app.close()
  }
})

const pdfOf = (name: string, ...pages: string[]): string => {
  const imgs = pages.map((size, i) => image(`${name}-p${i}.png`, size))
  const p = join(work, name)
  execFileSync(MAGICK, [...imgs, p], { env: magickEnv })
  return p
}
// This mutool build prints `<MediaBox l="0" b="0" r="200" t="100" />` per page.
const pageWidths = (pdf: string): number[] =>
  [
    ...execFileSync(MUTOOL, ['pages', pdf])
      .toString()
      .matchAll(/<MediaBox[^>]*\br="([\d.]+)"/g)
  ].map((m) => Math.round(Number(m[1])))

test('pdf merge keeps argument order; split keeps the listed pages; burst makes a folder', () => {
  pdfOf('a.pdf', '100x100')
  pdfOf('b.pdf', '200x100', '300x100', '400x100')
  const merged = cli(['pdf', 'merge', 'b.pdf', 'a.pdf', '--json'])
  expect(merged.code).toBe(0)
  const out = of(merged.events, 'done')[0].output as string
  expect(out).toBe(join(work, 'b (merged).pdf'))
  expect(pageWidths(out)).toEqual([200, 300, 400, 100])

  const split = cli(['pdf', 'split', 'b.pdf', '--pages', '2-3', '--json'])
  expect(pageWidths(of(split.events, 'done')[0].output as string)).toEqual([300, 400])

  const burst = cli(['pdf', 'burst', 'b.pdf', '--json'])
  expect(of(burst.events, 'done')[0]).toMatchObject({
    output: join(work, 'b (split)'),
    outputKind: 'dir',
    files: 3
  })
})

test('pdf tools reject non-PDF inputs; pdf compress is compress', () => {
  image('x.png')
  const bad = cli(['pdf', 'extract-text', 'x.png', '--json'])
  expect(bad.code).toBe(2)
  expect(of(bad.events, 'error')[0]).toMatchObject({ code: 'UNSUPPORTED_KIND' })
  pdfOf('c.pdf', '100x100')
  const c = cli(['pdf', 'compress', 'c.pdf', '--level', 'lossless', '--json'])
  expect(c.code).toBe(0)
  expect(of(c.events, 'done')[0].output).toBe(join(work, 'c (compressed).pdf'))
})

test('formats --json and doctor --json produce valid events', () => {
  const f = cli(['formats', '--json'])
  expect(f.code).toBe(0)
  expect(Object.keys(of(f.events, 'formats')[0].data as object)).toContain('convert')
  const d = cli(['doctor', '--json'])
  expect([0, 1]).toContain(d.code)
  expect(of(d.events, 'check').find((c) => c.id === 'magick')).toMatchObject({ status: 'ok' })
  expect(d.events.at(-1)).toMatchObject({ event: 'summary' })
})
