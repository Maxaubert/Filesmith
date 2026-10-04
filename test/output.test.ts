import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { reserveFileInDir, reserveOutPath, resolveOutDir, uniqueOutDir } from '../src/main/output'

// Collision-safe output naming is a hard rule (never overwrite the user's
// source or an existing file). These tests target the functions PRODUCTION
// actually calls — reserveFileInDir / reserveOutPath, the atomic 'wx' variants
// every tool module uses — not lookalike helpers.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'filesmith-out-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('reserveFileInDir', () => {
  it('uses the plain name when nothing exists, and leaves a placeholder', () => {
    const p = reserveFileInDir(dir, 'photo', '.png', 'converted')
    expect(p).toBe(join(dir, 'photo.png'))
    // The reservation is the placeholder: it must exist the moment we return,
    // so a concurrent job cannot pick the same name.
    expect(existsSync(p)).toBe(true)
    expect(statSync(p).size).toBe(0)
  })

  it('escalates name.ext -> name (tag).ext -> name (tag 2).ext', () => {
    writeFileSync(join(dir, 'photo.png'), 'x')
    expect(reserveFileInDir(dir, 'photo', '.png', 'converted')).toBe(
      join(dir, 'photo (converted).png')
    )
    // The reservation above now exists, so the next call must skip past it.
    expect(reserveFileInDir(dir, 'photo', '.png', 'converted')).toBe(
      join(dir, 'photo (converted 2).png')
    )
    expect(reserveFileInDir(dir, 'photo', '.png', 'converted')).toBe(
      join(dir, 'photo (converted 3).png')
    )
  })

  it('two consecutive reservations never collide', () => {
    const a = reserveFileInDir(dir, 'clip', '.mp4', 'compressed')
    const b = reserveFileInDir(dir, 'clip', '.mp4', 'compressed')
    expect(a).not.toBe(b)
    expect(existsSync(a)).toBe(true)
    expect(existsSync(b)).toBe(true)
  })

  it('normalizes an extension without a leading dot', () => {
    expect(reserveFileInDir(dir, 'a', 'webp', 'converted')).toBe(join(dir, 'a.webp'))
  })

  it('propagates a non-EEXIST errno instead of looping', () => {
    // A destination that cannot be created (missing directory) must surface the
    // real errno so the friendly-error mapping can name it, not spin forever.
    expect(() => reserveFileInDir(join(dir, 'no-such-dir'), 'a', '.png', 'tag')).toThrow()
  })
})

describe('reserveOutPath', () => {
  it('never returns the source path (mkv -> mp4 when mp4 exists)', () => {
    writeFileSync(join(dir, 'clip.mkv'), '')
    writeFileSync(join(dir, 'clip.mp4'), '') // unrelated existing file must be protected
    const out = reserveOutPath(join(dir, 'clip.mkv'), '.mp4', 'converted')
    expect(out).toBe(join(dir, 'clip (converted).mp4'))
  })

  it('never returns the source path even for a same-extension operation', () => {
    const src = join(dir, 'photo.png')
    writeFileSync(src, 'source bytes')
    const out = reserveOutPath(src, '.png', 'resized')
    expect(out).not.toBe(src)
    expect(out).toBe(join(dir, 'photo (resized).png'))
    // And the source is untouched.
    expect(statSync(src).size).toBeGreaterThan(0)
  })
})

describe('uniqueOutDir', () => {
  it('suffixes a taken directory name', () => {
    mkdirSync(join(dir, 'pages'))
    expect(uniqueOutDir(dir, 'pages')).toBe(join(dir, 'pages (2)'))
  })
})

describe('output folder', () => {
  it('reserves the output in the chosen folder, not next to the source', () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-outdir-'))
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir)
    mkdirSync(outDir)
    const src = join(srcDir, 'a.png')
    writeFileSync(src, 'x')
    const out = reserveOutPath(src, '.webp', 'converted', outDir)
    expect(out).toBe(join(outDir, 'a.webp'))
    expect(existsSync(join(srcDir, 'a.webp'))).toBe(false)
  })

  it('keeps collision safety inside the chosen folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-outdir-'))
    writeFileSync(join(root, 'a.webp'), 'existing')
    const out = reserveOutPath(join(root, 'elsewhere', 'a.png'), '.webp', 'converted', root)
    expect(out).toBe(join(root, 'a (converted).webp'))
  })

  it('treats an empty or missing option as next to the source', () => {
    expect(resolveOutDir(undefined)).toBeUndefined()
    expect(resolveOutDir('')).toBeUndefined()
  })

  it('refuses a folder that no longer exists instead of writing elsewhere', () => {
    const gone = join(tmpdir(), `fs-gone-${Date.now()}`)
    expect(() => resolveOutDir(gone)).toThrow(/Output folder not found/)
  })
})
