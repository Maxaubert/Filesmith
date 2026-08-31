import { _electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { FFMPEG, FFPROBE, MAGICK, MAIN, MUTOOL, ROOT, SEVENZIP, magickEnv, runJob } from './helpers'

// The full workflow matrix, run against the REAL built app: every operation of
// every category, through the actual preload bridge -> IPC -> queue -> engine
// -> bundled binary, asserting on the bytes that land on disk. Fixtures are
// synthesized into one temp dir (outputs land beside their sources, so the
// teardown sweep removes everything the suite produced).

const binariesPresent = [MAGICK, FFMPEG, FFPROBE, MUTOOL, SEVENZIP].every(existsSync)

let app: ElectronApplication
let page: Page
let dir: string

// --- fixture builders (bundled binaries only — nothing from PATH) -----------

const magick = (args: string[]): string =>
  execFileSync(MAGICK, args, { env: magickEnv, encoding: 'utf-8' })
const ffmpeg = (args: string[]): void => {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: 'pipe' })
}
const ffprobeJson = (args: string[]): unknown =>
  JSON.parse(
    execFileSync(FFPROBE, ['-v', 'quiet', '-print_format', 'json', ...args], {
      encoding: 'utf-8'
    })
  )
const sevenZip = (args: string[], cwd?: string): string =>
  execFileSync(SEVENZIP, args, { cwd, encoding: 'utf-8' })
/** Entry names inside an archive, via `7z l -slt` (the first Path is the
 * archive itself). */
const entriesOf = (archive: string): string[] =>
  sevenZip(['l', '-slt', archive])
    .split('\n')
    .filter((l) => l.startsWith('Path = '))
    .map((l) => l.slice(7).trim())
    .slice(1)
const identify = (fmt: string, file: string): string =>
  magick(['identify', '-format', fmt, file]).trim()
const pageCount = (pdf: string): number => {
  const out = execFileSync(MUTOOL, ['info', pdf], { encoding: 'utf-8' })
  return Number(/Pages:\s*(\d+)/i.exec(out)?.[1] ?? 0)
}

test.beforeAll(async () => {
  test.skip(!existsSync(MAIN), 'run `npm run build` first')
  test.skip(!binariesPresent, 'bundled binaries not fetched')
  dir = mkdtempSync(join(tmpdir(), 'filesmith-wf-'))

  // Images: an opaque photo, a transparent logo, an animated GIF.
  magick(['-size', '400x300', 'gradient:blue-red', join(dir, 'photo.png')])
  magick([
    '-size',
    '200x200',
    'xc:none',
    '-fill',
    'white',
    '-draw',
    'circle 100,100 100,40',
    join(dir, 'logo.png')
  ])
  magick([
    '-delay',
    '20',
    '-size',
    '100x100',
    'xc:red',
    'xc:green',
    'xc:blue',
    join(dir, 'anim.gif')
  ])

  // Video: an odd-scaling source (854x480 hits the divisibility fix) + a clip.
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=3:size=854x480:rate=30',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    join(dir, 'clip854.mp4')
  ])

  // Audio: a plain tone, a lossless WAV, and an MP3 carrying PNG cover art
  // (the cover-art regression: it used to be re-encoded into a giant PNG).
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    join(dir, 'plain.mp3')
  ])
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', join(dir, 'tone.wav')])
  ffmpeg([
    '-i',
    join(dir, 'plain.mp3'),
    '-i',
    join(dir, 'photo.png'),
    '-map',
    '0:a',
    '-map',
    '1',
    '-c:a',
    'copy',
    '-c:v',
    'png',
    '-disposition:v',
    'attached_pic',
    join(dir, 'covered.mp3')
  ])

  // PDFs: a 3-page image PDF, and (via the app itself later) a text PDF.
  magick([
    join(dir, 'photo.png'),
    join(dir, 'logo.png'),
    join(dir, 'photo.png'),
    join(dir, 'pages3.pdf')
  ])

  // Comic archive: pages named so a lexicographic sort would scramble them
  // (p10 before p2), which is exactly what the natural ordering has to fix.
  const comicSrc = join(dir, 'comic-src')
  mkdirSync(comicSrc)
  for (const n of ['p1.png', 'p2.png', 'p10.png'])
    magick(['-size', '120x160', 'gradient:white-black', join(comicSrc, n)])
  sevenZip(['a', '-tzip', join(dir, 'comic.cbz'), '*', '-y'], comicSrc)

  // Document: real prose so extract-text has something to find.
  writeFileSync(
    join(dir, 'notes.txt'),
    'Filesmith end-to-end fixture.\nSecond line with unicode: æøå — and a % sign.\n'
  )

  // Launch by PACKAGE ROOT, not the main script: `electron out/main/index.js`
  // makes app.getAppPath() resolve to out/main, which silently hides every
  // resources/ tree and lets resolveTool fall back to PATH binaries — the
  // suite would then test the machine's tools, not the bundled ones.
  app = await _electron.launch({ args: [ROOT] })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
  // Everything the suite made — fixtures AND outputs — lives under this dir.
  if (dir) rmSync(dir, { recursive: true, force: true })
})

// --- UI navigation -----------------------------------------------------------

/** Tools always opens on its grid, however you last left it. */
async function openToolsGrid(p: Page): Promise<void> {
  await p.locator('button:has-text("Tools")').first().click()
  await expect(p.locator('h1', { hasText: 'Tools' }).first()).toBeVisible()
}

test('the rail lists every verb and opens its workspace', async () => {
  for (const verb of ['Convert', 'Compress', 'Resize', 'Upscale', 'Remove BG', 'Generate']) {
    await page.locator(`button:has-text("${verb}")`).first().click()
    await expect(page.locator('h1', { hasText: verb }).first()).toBeVisible()
  }
  await openToolsGrid(page)
  await page.locator('button:has-text("Convert")').first().click()
})

test('Tools groups its one-off verbs and opens one as a workspace', async () => {
  await openToolsGrid(page)
  for (const t of ['Extract text', 'Pages to PNG', 'Merge', 'Split', 'Burst']) {
    await expect(page.locator(`text=${t}`).first()).toBeVisible()
  }
  // Archive work is an ordinary Convert now, not a tool hidden in here.
  await expect(page.locator('text=Archive to PDF')).toHaveCount(0)
  await expect(page.locator('text=PDF to CBZ')).toHaveCount(0)
  await page.locator('button:has-text("Merge")').first().click()
  // A tool workspace is an ordinary queue titled with the tool's name.
  await expect(page.locator('h1', { hasText: 'Merge' }).first()).toBeVisible()
  await expect(page.locator('text=Files').first()).toBeVisible()
  // Back returns to the grid, which is the app's only second level.
  await page.locator('button[aria-label="Back to Tools"]').first().click()
  await expect(page.locator('h1', { hasText: 'Tools' }).first()).toBeVisible()
  await page.locator('button:has-text("Convert")').first().click()
})

// NOTE: the mixed-kind queue, its group headers and the kind-scoped options
// panel are covered by unit tests (queue-groups, verb-state), not here. Adding
// files to the UI needs a real OS drop or a native file dialog, and neither is
// drivable from Playwright without a production-only test seam.

// --- Images ------------------------------------------------------------------

test('convert: png -> jpg, webp, bmp (flattened), multi-size ico', async () => {
  for (const format of ['.jpg', '.webp', '.bmp', '.ico']) {
    const e = await runJob(page, 'convert', join(dir, 'photo.png'), {
      format,
      quality: 'balanced'
    })
    expect(e.status, format).toBe('done')
    expect(e.outputPath!.endsWith(format)).toBe(true)
    expect(statSync(e.outputPath!).size).toBeGreaterThan(0)
  }
  // The ICO really is multi-size (icon:auto-resize).
  const ico = join(dir, 'photo.ico')
  expect(identify('%wx%h;', ico).split(';').filter(Boolean).length).toBeGreaterThan(1)
})

test('convert: animated gif -> webp keeps every frame', async () => {
  const e = await runJob(page, 'convert', join(dir, 'anim.gif'), {
    format: '.webp',
    quality: 'balanced'
  })
  expect(e.status).toBe('done')
  expect(identify('%n;', e.outputPath!).split(';').filter(Boolean)[0]).toBe('3')
})

test('convert: same format is refused, not silently copied', async () => {
  const e = await runJob(page, 'convert', join(dir, 'photo.png'), { format: '.png' })
  expect(e.status).toBe('failed')
  expect(e.error).toMatch(/already that format/i)
})

test('compress image: caesium keep-format and magick -> webp both shrink-or-report', async () => {
  const keep = await runJob(page, 'compress', join(dir, 'photo.png'), {
    quality: 60,
    imageFormat: 'keep'
  })
  expect(keep.status).toBe('done')
  expect(basename(keep.outputPath!)).toBe('photo (compressed).png')

  const webp = await runJob(page, 'compress', join(dir, 'photo.png'), {
    quality: 60,
    imageFormat: 'webp'
  })
  expect(webp.status).toBe('done')
  expect(webp.outputPath!.endsWith('.webp')).toBe(true)
})

test('resize: percent, and exact stretch dimensions', async () => {
  const pct = await runJob(page, 'resize', join(dir, 'photo.png'), {
    mode: 'percent',
    percent: 50
  })
  expect(pct.status).toBe('done')
  expect(identify('%wx%h', pct.outputPath!)).toBe('200x150')

  const dim = await runJob(page, 'resize', join(dir, 'photo.png'), {
    mode: 'dimensions',
    width: 200,
    height: 100,
    fit: 'stretch'
  })
  expect(dim.status).toBe('done')
  expect(identify('%wx%h', dim.outputPath!)).toBe('200x100')
})

test('resize: animated gif is coalesced and stays animated', async () => {
  const e = await runJob(page, 'resize', join(dir, 'anim.gif'), { mode: 'percent', percent: 50 })
  expect(e.status).toBe('done')
  expect(identify('%n;', e.outputPath!).split(';').filter(Boolean)[0]).toBe('3')
  expect(identify('%wx%h;', e.outputPath!).startsWith('50x50')).toBe(true)
})

test('collision safety: running the same convert twice yields two distinct outputs', async () => {
  const a = await runJob(page, 'convert', join(dir, 'logo.png'), { format: '.webp' })
  const b = await runJob(page, 'convert', join(dir, 'logo.png'), { format: '.webp' })
  expect(a.status).toBe('done')
  expect(b.status).toBe('done')
  expect(a.outputPath).not.toBe(b.outputPath)
  expect(existsSync(a.outputPath!)).toBe(true)
  expect(existsSync(b.outputPath!)).toBe(true)
})

test('upscale: Real-ESRGAN 2x keeps size AND the alpha channel', async () => {
  test.setTimeout(180_000)
  const e = await runJob(page, 'upscale', join(dir, 'logo.png'), {
    upscaleModel: 'photo',
    upscaleFactor: 2
  })
  expect(e.status, e.error).toBe('done')
  expect(identify('%wx%h', e.outputPath!)).toBe('400x400')
  // restoreAlpha: the RGB-only network output gets the source matte back.
  expect(identify('%A', e.outputPath!).toLowerCase()).not.toContain('undefined')
})

test('remove background: rembg cuts the subject out (skips if uv is unavailable)', async () => {
  test.setTimeout(600_000) // first run downloads the engine + model
  const status = await page.evaluate(() => window.filesmith.removebgStatus())
  test.skip(!status.ready && !status.uvAvailable, 'uv not installed on this machine')
  const e = await runJob(page, 'removebg', join(dir, 'photo.png'), {})
  expect(e.status).toBe('done')
  expect(e.outputPath!.endsWith('.png')).toBe(true)
  expect(identify('%A', e.outputPath!).toLowerCase()).not.toContain('undefined')
})

// --- Video -------------------------------------------------------------------

test('video convert: mp4 -> mkv and a palette GIF', async () => {
  const mkv = await runJob(page, 'convert', join(dir, 'clip854.mp4'), { format: '.mkv' })
  expect(mkv.status).toBe('done')
  expect(statSync(mkv.outputPath!).size).toBeGreaterThan(0)

  const gif = await runJob(page, 'convert', join(dir, 'clip854.mp4'), { format: '.gif' })
  expect(gif.status).toBe('done')
  const info = ffprobeJson(['-show_streams', gif.outputPath!]) as {
    streams: { codec_name: string }[]
  }
  expect(info.streams[0].codec_name).toBe('gif')
})

test('video compress: the 25% scale position that used to abort now encodes evenly', async () => {
  // 854x480 * 0.25 = 213.5x120 — the exact "width not divisible by 2" case.
  const e = await runJob(page, 'compress', join(dir, 'clip854.mp4'), {
    videoCodec: 'h264',
    quality: 70,
    scale: 25
  })
  expect(e.status).toBe('done')
  const info = ffprobeJson(['-show_streams', e.outputPath!]) as {
    streams: { width?: number; height?: number }[]
  }
  const v = info.streams.find((s) => s.width)
  expect((v!.width! % 2) + (v!.height! % 2)).toBe(0)
  expect(v!.width).toBe(212)
})

// --- Audio -------------------------------------------------------------------

test('audio compress keep-format: cover art is stream-copied, not blown up', async () => {
  const src = join(dir, 'covered.mp3')
  const e = await runJob(page, 'compress', src, { audioCodec: 'keep', audioBitrate: 96 })
  expect(e.status).toBe('done')
  const info = ffprobeJson(['-show_streams', e.outputPath!]) as {
    streams: { codec_type: string; codec_name: string }[]
  }
  // The attached picture is still there, still PNG (copied, not re-encoded).
  const pic = info.streams.find((s) => s.codec_type === 'video')
  expect(pic?.codec_name).toBe('png')
  // And the "compressed" file did not balloon past its source.
  expect(statSync(e.outputPath!).size).toBeLessThan(statSync(src).size * 1.5)
})

test('audio compress: lossless wav keeps every sample as FLAC', async () => {
  const e = await runJob(page, 'compress', join(dir, 'tone.wav'), {
    audioCodec: 'keep',
    audioBitrate: 192
  })
  expect(e.status).toBe('done')
  expect(e.outputPath!.endsWith('.flac')).toBe(true)
  expect(statSync(e.outputPath!).size).toBeLessThan(statSync(join(dir, 'tone.wav')).size)
})

test('audio convert: mp3 -> m4a and -> opus', async () => {
  for (const format of ['.m4a', '.opus']) {
    const e = await runJob(page, 'convert', join(dir, 'plain.mp3'), { format })
    expect(e.status, format).toBe('done')
    expect(statSync(e.outputPath!).size).toBeGreaterThan(0)
  }
})

// --- Documents (LibreOffice) -------------------------------------------------

test('document convert: txt -> pdf and txt -> docx', async () => {
  test.setTimeout(180_000) // first soffice launch builds a profile
  const pdf = await runJob(page, 'convert', join(dir, 'notes.txt'), { format: '.pdf' })
  expect(pdf.status).toBe('done')
  expect(basename(pdf.outputPath!)).toBe('notes.pdf')
  expect(pageCount(pdf.outputPath!)).toBeGreaterThan(0)

  const docx = await runJob(page, 'convert', join(dir, 'notes.txt'), { format: '.docx' })
  expect(docx.status).toBe('done')
  expect(statSync(docx.outputPath!).size).toBeGreaterThan(0)
})

// --- PDF ---------------------------------------------------------------------

test('pdf extract-text: recovers the document text (unicode intact)', async () => {
  const e = await runJob(page, 'pdf', join(dir, 'notes.pdf'), { op: 'extract-text' })
  expect(e.status).toBe('done')
  const fs = await import('fs')
  const text = fs.readFileSync(e.outputPath!, 'utf-8')
  expect(text).toContain('Filesmith end-to-end fixture')
  expect(text).toContain('æøå')
})

test('pdf pages-to-images: one PNG per page in a fresh folder', async () => {
  const e = await runJob(page, 'pdf', join(dir, 'pages3.pdf'), {
    op: 'pages-to-images',
    dpi: 72
  })
  expect(e.status).toBe('done')
  const files = readdirSync(e.outputPath!)
  expect(files.filter((f) => f.endsWith('.png'))).toHaveLength(3)
})

test('pdf split-range keeps the listed pages', async () => {
  const e = await runJob(page, 'pdf', join(dir, 'pages3.pdf'), { op: 'split-range', range: '1,3' })
  expect(e.status).toBe('done')
  expect(pageCount(e.outputPath!)).toBe(2)
})

test('pdf burst: every page becomes its own file', async () => {
  const e = await runJob(page, 'pdf', join(dir, 'pages3.pdf'), { op: 'split-pages' })
  expect(e.status).toBe('done')
  const parts = readdirSync(e.outputPath!).filter((f) => f.endsWith('.pdf'))
  expect(parts).toHaveLength(3)
  expect(pageCount(join(e.outputPath!, parts[0]))).toBe(1)
})

test('pdf extract-images pulls the embedded rasters', async () => {
  const e = await runJob(page, 'pdf', join(dir, 'pages3.pdf'), { op: 'extract-images' })
  expect(e.status).toBe('done')
  expect(readdirSync(e.outputPath!).length).toBeGreaterThan(0)
})

test('pdf merge concatenates in order', async () => {
  const e = await runJob(page, 'pdf', join(dir, 'notes.pdf'), {
    op: 'merge',
    mergeInputs: [join(dir, 'notes.pdf'), join(dir, 'pages3.pdf')]
  })
  expect(e.status).toBe('done')
  expect(pageCount(e.outputPath!)).toBe(pageCount(join(dir, 'notes.pdf')) + 3)
})

test('pdf compress: lossless (mutool) and balanced (Ghostscript)', async () => {
  const lossless = await runJob(page, 'compress', join(dir, 'pages3.pdf'), {
    pdfLevel: 'lossless'
  })
  expect(lossless.status).toBe('done')
  expect(pageCount(lossless.outputPath!)).toBe(3)

  const balanced = await runJob(page, 'compress', join(dir, 'pages3.pdf'), {
    pdfLevel: 'balanced',
    pdfGray: false
  })
  expect(balanced.status, balanced.error).toBe('done')
  expect(pageCount(balanced.outputPath!)).toBe(3)
})

// --- Edge cases --------------------------------------------------------------

test('a unicode + spaces + % filename survives every stage', async () => {
  const wild = join(dir, 'æøå 50% off 图片.png')
  const fs = await import('fs')
  fs.copyFileSync(join(dir, 'photo.png'), wild)
  const conv = await runJob(page, 'convert', wild, { format: '.jpg', quality: 'best' })
  expect(conv.status).toBe('done')
  expect(existsSync(conv.outputPath!)).toBe(true)
  const rez = await runJob(page, 'resize', wild, { mode: 'percent', percent: 25 })
  expect(rez.status).toBe('done')
  expect(identify('%wx%h', rez.outputPath!)).toBe('100x75')
})

// --- Generate (needs the user's ComfyUI; skips cleanly without it) -----------

test('generate: one 512px image through headless ComfyUI, then delete it', async () => {
  test.setTimeout(600_000)
  const status = await page.evaluate(() => window.filesmith.generateStatus())
  const model = (status.models ?? []).find((m: { runnable?: boolean }) => m.runnable) as
    { name: string; arch: string } | undefined
  test.skip(!status.available || !model, 'no runnable ComfyUI generation model on this machine')

  const info = (status.archInfo?.[model!.arch] ?? {}) as {
    steps?: number
    cfg?: number
    guidance?: number
  }
  const produced = await page.evaluate(
    ({ modelName, steps, cfg, guidance }) =>
      new Promise<{ ok: boolean; error?: string; paths: string[] }>((resolvePromise) => {
        const id = 'e2e-gen'
        const paths: string[] = []
        const unI = window.filesmith.onGenerateImage((p) => {
          if (p.id === id) paths.push(p.path)
        })
        void window.filesmith
          .generateRun(id, {
            prompt: 'a small red cube on a white table, studio photo',
            model: modelName,
            negative: '',
            style: 'none',
            width: 512,
            height: 512,
            count: 1,
            steps,
            cfg,
            guidance,
            seed: 12345
          } as never)
          .then((r) => {
            unI()
            resolvePromise({ ...r, paths })
          })
      }),
    {
      modelName: model!.name,
      steps: info.steps ?? 20,
      cfg: info.cfg ?? 7,
      guidance: info.guidance ?? 3.5
    }
  )
  expect(produced.ok, produced.error).toBe(true)
  expect(produced.paths.length).toBe(1)
  const fs = await import('fs')
  expect(fs.existsSync(produced.paths[0])).toBe(true)
  expect(fs.statSync(produced.paths[0]).size).toBeGreaterThan(1000)
  // Clean up: the generated image is the one output that lands OUTSIDE the
  // suite's temp dir (the app writes to the user's output folder).
  for (const p of produced.paths) fs.rmSync(p, { force: true })
})

// --- Archives ----------------------------------------------------------------

test('archive convert: cbz -> cb7, contents flat and page order intact', async () => {
  const e = await runJob(page, 'archive', join(dir, 'comic.cbz'), {
    op: 'repack',
    format: '.cb7',
    store: true
  })
  expect(e.status).toBe('done')
  expect(e.outputPath!.endsWith('.cb7')).toBe(true)
  expect(statSync(e.outputPath!).size).toBeGreaterThan(0)
  // No wrapper folder: a nested path here shows as an empty book in a reader.
  expect(entriesOf(e.outputPath!).sort()).toEqual(['p1.png', 'p10.png', 'p2.png'])
})

test('archive convert: cbz -> zip and -> cbt', async () => {
  for (const format of ['.zip', '.cbt']) {
    const e = await runJob(page, 'archive', join(dir, 'comic.cbz'), { op: 'repack', format })
    expect(e.status, format).toBe('done')
    expect(entriesOf(e.outputPath!)).toHaveLength(3)
  }
})

test('archive extract: unpacks into its own folder', async () => {
  const e = await runJob(page, 'archive', join(dir, 'comic.cbz'), { op: 'extract' })
  expect(e.status).toBe('done')
  expect(readdirSync(e.outputPath!).sort()).toEqual(['p1.png', 'p10.png', 'p2.png'])
})

test('archive to-pdf: one page per image, in reading order', async () => {
  const e = await runJob(page, 'archive', join(dir, 'comic.cbz'), { op: 'to-pdf' })
  expect(e.status).toBe('done')
  expect(pageCount(e.outputPath!)).toBe(3)
})

test('archive to-pdf: an archive with no images fails instead of writing an empty PDF', async () => {
  const src = join(dir, 'noimg-src')
  mkdirSync(src)
  writeFileSync(join(src, 'readme.txt'), 'no pages here')
  sevenZip(['a', '-tzip', join(dir, 'noimg.cbz'), '*', '-y'], src)
  const e = await runJob(page, 'archive', join(dir, 'noimg.cbz'), { op: 'to-pdf' })
  expect(e.status).toBe('failed')
  expect(e.error).toMatch(/No images/i)
})

test('pdf to-cbz: pages are zero-padded jpegs so a reader orders them correctly', async () => {
  const e = await runJob(page, 'archive', join(dir, 'pages3.pdf'), {
    op: 'from-pdf',
    format: '.cbz',
    dpi: 72,
    pageFormat: 'jpg',
    pageQuality: 80
  })
  expect(e.status).toBe('done')
  expect(e.outputPath!.endsWith('.cbz')).toBe(true)
  expect(entriesOf(e.outputPath!).sort()).toEqual([
    'page-0001.jpg',
    'page-0002.jpg',
    'page-0003.jpg'
  ])
})

test('pdf to-cbz: PNG pages when asked', async () => {
  const e = await runJob(page, 'archive', join(dir, 'pages3.pdf'), {
    op: 'from-pdf',
    format: '.cb7',
    dpi: 72,
    pageFormat: 'png'
  })
  expect(e.status).toBe('done')
  expect(entriesOf(e.outputPath!).every((n) => n.endsWith('.png'))).toBe(true)
})

test('archive collision safety: the same conversion twice yields two files', async () => {
  const a = await runJob(page, 'archive', join(dir, 'comic.cbz'), { op: 'repack', format: '.cb7' })
  const b = await runJob(page, 'archive', join(dir, 'comic.cbz'), { op: 'repack', format: '.cb7' })
  expect(a.outputPath).not.toBe(b.outputPath)
  expect(existsSync(a.outputPath!) && existsSync(b.outputPath!)).toBe(true)
})
