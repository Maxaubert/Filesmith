import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { planFileInDir, planOutDir, reserveFileInDir } from '../src/main/output'
import { planOutput } from '../src/main/tools/plan'
import { fileKind } from '@shared/fileKind'
import type { FileInfo } from '@shared/types'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'filesmith-plan-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const info = (name: string): FileInfo => {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return { path: join(dir, name), name, ext, kind: fileKind(ext), size: 10 }
}

describe('planFileInDir', () => {
  it('predicts the same names as reserveFileInDir and creates nothing', () => {
    writeFileSync(join(dir, 'photo.webp'), 'x')
    writeFileSync(join(dir, 'photo (converted).webp'), 'x')
    const before = readdirSync(dir).sort()
    const planned = planFileInDir(dir, 'photo', '.webp', 'converted')
    expect(readdirSync(dir).sort()).toEqual(before)
    const real = reserveFileInDir(dir, 'photo', '.webp', 'converted')
    expect(planned).toBe(real)
    expect(planned).toBe(join(dir, 'photo (converted 2).webp'))
  })

  it('treats names claimed earlier in the same run as taken (case-insensitive)', () => {
    const claimed = new Set<string>()
    const a = planFileInDir(dir, 'photo', 'webp', 'converted', claimed)
    const b = planFileInDir(dir, 'PHOTO', '.webp', 'converted', claimed)
    expect(a).toBe(join(dir, 'photo.webp'))
    expect(b).toBe(join(dir, 'PHOTO (converted).webp'))
  })
})

describe('planOutDir', () => {
  it('base, then base (2), honouring claims', () => {
    mkdirSync(join(dir, 'doc (pages)'))
    const claimed = new Set<string>()
    expect(planOutDir(dir, 'doc (pages)', claimed)).toBe(join(dir, 'doc (pages) (2)'))
    expect(planOutDir(dir, 'doc (pages)', claimed)).toBe(join(dir, 'doc (pages) (3)'))
  })
})

describe('planOutput', () => {
  const c = (): Set<string> => new Set()
  it.each([
    ['convert', 'a.png', { format: '.webp' }, 'a.webp'],
    ['convert', 'a.pdf', { format: '.txt' }, 'a.txt'],
    ['archive', 'a.cbz', { op: 'repack', format: '.cb7' }, 'a.cb7'],
    ['archive', 'a.cbz', { op: 'to-pdf' }, 'a.pdf'],
    ['archive', 'a.pdf', { op: 'from-pdf', format: '.cbz' }, 'a.cbz'],
    ['compress', 'a.jpg', { imageFormat: 'keep' }, 'a (compressed).jpg'],
    ['compress', 'a.png', { imageFormat: 'avif' }, 'a.avif'],
    ['compress', 'a.mov', {}, 'a.mp4'],
    ['compress', 'a.flac', { audioCodec: 'keep' }, 'a (compressed).flac'],
    ['compress', 'a.mp3', { audioCodec: 'opus' }, 'a.opus'],
    ['compress', 'a.pdf', { pdfLevel: 'smallest' }, 'a (compressed).pdf'],
    ['resize', 'a.gif', {}, 'a (resized).gif'],
    ['upscale', 'a.jpg', {}, 'a.png'],
    ['removebg', 'a.png', {}, 'a (no-bg).png'],
    ['pdf', 'a.pdf', { op: 'merge' }, 'a (merged).pdf'],
    ['pdf', 'a.pdf', { op: 'split-range', range: '1-2' }, 'a (pages).pdf'],
    ['pdf', 'a.pdf', { op: 'extract-text' }, 'a.txt']
  ] as const)('%s %s %j -> %s (file)', (tool, name, options, expected) => {
    writeFileSync(join(dir, name), 'x')
    const out = planOutput(tool, info(name), { ...options }, undefined, c())
    expect(out).toEqual({ path: join(dir, expected), kind: 'file' })
  })

  it.each([
    ['split-pages', 'a (split)'],
    ['extract-images', 'a (images)'],
    ['pages-to-images', 'a (pages)']
  ])('pdf %s -> folder %s', (op, expected) => {
    const out = planOutput('pdf', info('a.pdf'), { op }, undefined, c())
    expect(out).toEqual({ path: join(dir, expected), kind: 'dir' })
  })

  it('honours outDir', () => {
    const out = join(dir, 'out')
    mkdirSync(out)
    expect(planOutput('resize', info('a.png'), {}, out, c()).path).toBe(join(out, 'a.png'))
  })

  it('rejects an unknown pdf op', () => {
    expect(() => planOutput('pdf', info('a.pdf'), { op: 'nope' }, undefined, c())).toThrow(
      'Unknown pdf operation: nope'
    )
  })
})
