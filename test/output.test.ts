import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { uniqueFileInDir, uniqueOutPath, uniqueOutDir } from '../src/main/output'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'filesmith-out-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('uniqueFileInDir', () => {
  it('uses the plain name when nothing exists', () => {
    expect(uniqueFileInDir(dir, 'photo', '.png', 'converted')).toBe(join(dir, 'photo.png'))
  })

  it('adds the tag when the plain name is taken', () => {
    writeFileSync(join(dir, 'photo.png'), '')
    expect(uniqueFileInDir(dir, 'photo', '.png', 'converted')).toBe(
      join(dir, 'photo (converted).png')
    )
  })

  it('numbers further collisions', () => {
    writeFileSync(join(dir, 'photo.png'), '')
    writeFileSync(join(dir, 'photo (converted).png'), '')
    writeFileSync(join(dir, 'photo (converted 2).png'), '')
    expect(uniqueFileInDir(dir, 'photo', '.png', 'converted')).toBe(
      join(dir, 'photo (converted 3).png')
    )
  })

  it('normalizes an extension without a leading dot', () => {
    expect(uniqueFileInDir(dir, 'a', 'webp', 'converted')).toBe(join(dir, 'a.webp'))
  })
})

describe('uniqueOutPath', () => {
  it('never returns the source path (mkv -> mp4 when mp4 exists)', () => {
    writeFileSync(join(dir, 'clip.mkv'), '')
    writeFileSync(join(dir, 'clip.mp4'), '') // unrelated existing file must be protected
    const out = uniqueOutPath(join(dir, 'clip.mkv'), '.mp4', 'converted')
    expect(out).toBe(join(dir, 'clip (converted).mp4'))
  })
})

describe('uniqueOutDir', () => {
  it('suffixes a taken directory name', () => {
    mkdtempSync(join(dir, 'x')) // ensure dir exists
    writeFileSync(join(dir, 'pages'), '')
    expect(uniqueOutDir(dir, 'pages')).toBe(join(dir, 'pages (2)'))
  })
})
