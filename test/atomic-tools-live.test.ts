// Live coverage for atomic outputs across the engine: these SPAWN the bundled
// binaries (ffmpeg, ImageMagick, mutool, 7-Zip) and are skipped when
// resources/bin has not been populated. A canceled or failing job must leave
// no part and no final file; a successful one exactly the final file.
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getTool } from '../src/main/tools/registry'
import { PART_MARK } from '../src/main/atomicOutput'
import { fileKind } from '@shared/fileKind'
import type { FileInfo } from '@shared/types'

const BIN = resolve('resources/bin')
const FFMPEG = join(BIN, 'ffmpeg.exe')
const MAGICK = join(BIN, 'magick.exe')
const MUTOOL = join(BIN, 'mutool.exe')
const SEVEN = join(BIN, '7z.exe')
const haveAll = [FFMPEG, MAGICK, MUTOOL, SEVEN].every((p) => existsSync(p))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-atomic-live-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const ls = (): string[] => readdirSync(dir).sort()
const info = (p: string): FileInfo => {
  const ext = p.slice(p.lastIndexOf('.')).toLowerCase()
  return {
    path: p,
    name: p.split(/[\\/]/).pop()!,
    ext,
    kind: fileKind(ext),
    size: statSync(p).size
  }
}
const ctxWith = (
  signal: AbortSignal = new AbortController().signal,
  onProgress: (pct?: number, msg?: string) => void = () => {}
): { signal: AbortSignal; onProgress: (pct?: number, msg?: string) => void } => ({
  signal,
  onProgress
})

function makeVideo(name: string, seconds: number): string {
  const p = join(dir, name)
  execFileSync(FFMPEG, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    p
  ])
  return p
}

function makePng(name: string): string {
  const p = join(dir, name)
  execFileSync(MAGICK, ['-size', '64x48', 'xc:red', p])
  return p
}

function makePdf(name: string, pages: number): string {
  const imgs = Array.from({ length: pages }, (_, i) => makePng(`pg${i}.png`))
  const p = join(dir, name)
  execFileSync(MAGICK, [...imgs, p])
  for (const i of imgs) rmSync(i)
  return p
}

describe.skipIf(!haveAll)('atomic outputs (live)', () => {
  it('a canceled video compress leaves no partial and no final file', async () => {
    const src = makeVideo('long video.mp4', 20)
    const ctrl = new AbortController()
    const job = getTool('compress')!.run(
      info(src),
      { videoCodec: 'h265', quality: 60 },
      ctxWith(ctrl.signal)
    )
    // Wait until ffmpeg has written real bytes into the part file; the final
    // name meanwhile is still the empty placeholder.
    const part = join(dir, `long video (compressed)${PART_MARK}.mp4`)
    const final = join(dir, 'long video (compressed).mp4')
    for (let i = 0; i < 300 && !(existsSync(part) && statSync(part).size > 0); i++)
      await new Promise((r) => setTimeout(r, 50))
    expect(statSync(part).size).toBeGreaterThan(0)
    expect(statSync(final).size).toBe(0)
    ctrl.abort()
    await expect(job).rejects.toThrow()
    expect(ls()).toEqual(['long video.mp4'])
  }, 60_000)

  it('a successful video compress leaves exactly the final file', async () => {
    const src = makeVideo('short.mp4', 1)
    const out = await getTool('compress')!.run(
      info(src),
      { videoCodec: 'h264', quality: 40 },
      ctxWith()
    )
    expect(out).toBe(join(dir, 'short (compressed).mp4'))
    expect(statSync(out).size).toBeGreaterThan(0)
    expect(ls()).toEqual(['short (compressed).mp4', 'short.mp4'])
  }, 60_000)

  it('a failing convert (corrupt input) leaves nothing behind', async () => {
    const src = join(dir, 'broken.mp4')
    writeFileSync(src, 'this is not a video')
    await expect(
      getTool('convert')!.run(info(src), { format: '.mkv' }, ctxWith())
    ).rejects.toThrow()
    expect(ls()).toEqual(['broken.mp4'])
  })

  it('resize: success keeps the collision name, failure leaves nothing', async () => {
    const src = makePng('photo.png')
    writeFileSync(join(dir, 'photo (resized).png'), 'an older result')
    const out = await getTool('resize')!.run(info(src), { mode: 'percent', percent: 50 }, ctxWith())
    expect(out).toBe(join(dir, 'photo (resized 2).png'))
    const bad = join(dir, 'bad.png')
    writeFileSync(bad, 'not a png')
    await expect(
      getTool('resize')!.run(info(bad), { mode: 'percent', percent: 50 }, ctxWith())
    ).rejects.toThrow()
    expect(ls()).toEqual(['bad.png', 'photo (resized 2).png', 'photo (resized).png', 'photo.png'])
  })

  it('pdf split-pages: success swaps the folder in, cancel leaves no folder', async () => {
    const pdf = makePdf('doc.pdf', 3)
    const out = await getTool('pdf')!.run(info(pdf), { op: 'split-pages' }, ctxWith())
    expect(out).toBe(join(dir, 'doc (split)'))
    expect(readdirSync(out).sort()).toEqual(['doc-1.pdf', 'doc-2.pdf', 'doc-3.pdf'])
    // Cancel once page 1 is written into the part folder.
    const ctrl = new AbortController()
    const onProgress = (_p?: number, msg?: string): void => {
      if (msg?.startsWith('Splitting page 2')) ctrl.abort()
    }
    await expect(
      getTool('pdf')!.run(info(pdf), { op: 'split-pages' }, ctxWith(ctrl.signal, onProgress))
    ).rejects.toThrow()
    expect(ls()).toEqual(['doc (split)', 'doc.pdf'])
  })

  it('archive extract of a corrupt archive leaves no folder', async () => {
    const bad = join(dir, 'broken.cbz')
    writeFileSync(bad, 'PK not really a zip')
    await expect(
      getTool('archive')!.run({ ...info(bad), kind: 'archive' }, { op: 'extract' }, ctxWith())
    ).rejects.toThrow()
    expect(ls()).toEqual(['broken.cbz'])
  })
})
