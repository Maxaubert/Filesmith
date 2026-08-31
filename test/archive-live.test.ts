// Integration coverage for the archive engine: unlike the rest of the unit
// suite these SPAWN the bundled binaries, so they are skipped when
// resources/bin has not been populated (CI, and a fresh clone before
// `npm run fetch-binaries`). They caught the reserveOutPath placeholder
// colliding with `7z a` / `rar a`, which no pure-function test could.
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
import { join, resolve } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { getTool } from '../src/main/tools/registry'
import { resolveRar } from '../src/main/toolResolver'
import type { FileInfo } from '@shared/types'

const SEVEN = resolve('resources/bin/7z.exe')
const MAGICK = resolve('resources/bin/magick.exe')
const root = mkdtempSync(join(tmpdir(), 'fs-live-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ctx = { signal: new AbortController().signal, onProgress: (): void => {} }
const info = (p: string, ext: string): FileInfo => ({
  path: p,
  name: p.split(/[\\/]/).pop()!,
  ext,
  kind: 'archive',
  size: statSync(p).size
})

function makeCbz(name: string, pages: string[]): string {
  const src = join(root, name + '-src')
  mkdirSync(src, { recursive: true })
  for (const p of pages) execFileSync(MAGICK, ['-size', '80x120', 'xc:white', join(src, p)])
  const out = join(root, name + '.cbz')
  execFileSync(SEVEN, ['a', '-tzip', out, '*', '-y'], { cwd: src })
  return out
}

const list = (archive: string): string[] =>
  execFileSync(SEVEN, ['l', '-slt', archive], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.startsWith('Path = '))
    .map((l) => l.slice(7).trim())
    .slice(1)

describe.skipIf(!existsSync(SEVEN) || !existsSync(MAGICK))('archive engine (live)', () => {
  const tool = getTool('archive')!

  it('repacks a cbz into a cb7 with no wrapper folder', async () => {
    const cbz = makeCbz('comic', ['p1.png', 'p2.png', 'p10.png'])
    const out = await tool.run(info(cbz, '.cbz'), { op: 'repack', format: '.cb7' }, ctx)
    expect(out.endsWith('.cb7')).toBe(true)
    expect(statSync(out).size).toBeGreaterThan(0)
    expect(list(out).sort()).toEqual(['p1.png', 'p10.png', 'p2.png'])
  })

  it('extracts into a collision-free folder', async () => {
    const cbz = makeCbz('extractme', ['a.png', 'b.png'])
    const dir = await tool.run(info(cbz, '.cbz'), { op: 'extract' }, ctx)
    expect(readdirSync(dir).sort()).toEqual(['a.png', 'b.png'])
  })

  it('converts a comic archive to a PDF', async () => {
    const cbz = makeCbz('topdf', ['p1.png', 'p2.png', 'p10.png'])
    const out = await tool.run(info(cbz, '.cbz'), { op: 'to-pdf' }, ctx)
    expect(out.endsWith('.pdf')).toBe(true)
    const pages = execFileSync(resolve('resources/bin/mutool.exe'), ['info', out], {
      encoding: 'utf8'
    })
    expect(pages).toMatch(/Pages:\s*3/)
  })

  it('refuses an archive with no images', async () => {
    const src = join(root, 'noimg-src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'readme.txt'), 'hi')
    const cbz = join(root, 'noimg.cbz')
    execFileSync(SEVEN, ['a', '-tzip', cbz, '*', '-y'], { cwd: src })
    await expect(tool.run(info(cbz, '.cbz'), { op: 'to-pdf' }, ctx)).rejects.toThrow(/No images/)
  })

  it('converts a PDF to a cbz with zero-padded jpeg pages', async () => {
    const cbz = makeCbz(
      'pdfsrc',
      Array.from({ length: 12 }, (_, i) => `s${i}.png`)
    )
    const pdf = await tool.run(info(cbz, '.cbz'), { op: 'to-pdf' }, ctx)
    const out = await tool.run(
      { ...info(pdf, '.pdf'), kind: 'pdf' },
      { op: 'from-pdf', format: '.cbz', dpi: 72, pageFormat: 'jpg', pageQuality: 80 },
      ctx
    )
    const entries = list(out).sort()
    expect(entries).toHaveLength(12)
    expect(entries[0]).toBe('page-0001.jpg')
    expect(entries[1]).toBe('page-0002.jpg')
    expect(entries).toContain('page-0012.jpg')
  })

  // Writing rar needs WinRAR, which cannot be bundled; reading one never does.
  it.skipIf(!resolveRar())('round-trips a cbr through WinRAR and back', async () => {
    const cbz = makeCbz('torar', ['p1.png', 'p2.png'])
    const cbr = await tool.run(info(cbz, '.cbz'), { op: 'repack', format: '.cbr' }, ctx)
    expect(cbr.endsWith('.cbr')).toBe(true)
    expect(list(cbr).sort()).toEqual(['p1.png', 'p2.png'])

    // Reading it back needs only bundled 7-Zip.
    const back = await tool.run(info(cbr, '.cbr'), { op: 'repack', format: '.cbz' }, ctx)
    expect(list(back).sort()).toEqual(['p1.png', 'p2.png'])
  })

  it('never overwrites an existing output', async () => {
    const cbz = makeCbz('twice', ['p1.png'])
    const a = await tool.run(info(cbz, '.cbz'), { op: 'repack', format: '.cb7' }, ctx)
    const b = await tool.run(info(cbz, '.cbz'), { op: 'repack', format: '.cb7' }, ctx)
    expect(a).not.toBe(b)
    expect(existsSync(a) && existsSync(b)).toBe(true)
  })
})
