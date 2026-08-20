import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { magickFrame } from '../src/main/tools/convert'
import { buildMagickCompressArgs } from '../src/main/tools/compress'

// Paths containing `%` — `100%off.png`, `50%discount.pdf` — are real user
// input, and the engines printf-expand them: magick's InterpretImageFilename
// kicks in on READ once a scene spec (`[0]`) is appended, and on WRITE always;
// mutool draw and Ghostscript format their output path the same way. The read
// side is fixed by escaping `%` as `%%` (magickFrame); the write side by
// redirecting the tool to a %-free temp file (runToOutput) and copying onto
// the reserved name. These tests pin the escape helper and — when the bundled
// binary is present — the measured magick behaviour the fix rests on.

describe('magickFrame', () => {
  it('appends the scene spec', () => {
    expect(magickFrame('C:\\pics\\photo.png')).toBe('C:\\pics\\photo.png[0]')
  })

  it('escapes % so InterpretImageFilename round-trips it', () => {
    expect(magickFrame('C:\\pics\\100%off.png')).toBe('C:\\pics\\100%%off.png[0]')
    expect(magickFrame('C:\\50% done\\win%x2.png')).toBe('C:\\50%% done\\win%%x2.png[0]')
  })

  it('takes an explicit frame index', () => {
    expect(magickFrame('a.gif', 3)).toBe('a.gif[3]')
  })
})

describe('buildMagickCompressArgs with % in the source', () => {
  it('escapes the single-frame read', () => {
    const args = buildMagickCompressArgs('C:\\x\\100%off.png', 'C:\\x\\out.jpg', 80)
    expect(args[0]).toBe('C:\\x\\100%%off.png[0]')
  })

  it('leaves a multi-frame read unescaped (no scene spec, no interpretation)', () => {
    const args = buildMagickCompressArgs('C:\\x\\100%off.gif', 'C:\\x\\out.gif', 80)
    expect(args[0]).toBe('C:\\x\\100%off.gif')
  })
})

// Integration against the actual bundled binary: the exact failure that was
// measured (`unable to open image '1000ff.png'`) and the escape that fixes it.
const BIN = resolve(__dirname, '..', 'resources', 'bin')
const MAGICK = join(BIN, 'magick.exe')
const coders = join(BIN, 'modules', 'coders')
const magickEnv = {
  ...process.env,
  ...(existsSync(coders) ? { MAGICK_CODER_MODULE_PATH: coders, MAGICK_CONFIGURE_PATH: BIN } : {})
}

describe.skipIf(!existsSync(MAGICK))('bundled magick and % paths (integration)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'filesmith-pct-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  // A tiny valid PNG (1x1, white) so the test needs no fixture checkout.
  const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )

  const magick = (args: string[]): void => {
    execFileSync(MAGICK, args, { env: magickEnv, stdio: 'pipe' })
  }

  it('fails on an unescaped scene-spec read of a % path (the bug)', () => {
    const src = join(dir, '100%off.png')
    writeFileSync(src, PNG_1PX)
    expect(() => magick([`${src}[0]`, join(dir, 'bug.jpg')])).toThrow()
  })

  it('reads the same path fine once % is escaped (the fix)', () => {
    const src = join(dir, '100%off2.png')
    writeFileSync(src, PNG_1PX)
    const out = join(dir, 'fixed.jpg')
    magick([magickFrame(src), out])
    expect(existsSync(out)).toBe(true)
  })

  it('printf-expands a % OUTPUT path (why runToOutput must redirect it)', () => {
    const src = join(dir, 'plain.png')
    writeFileSync(src, PNG_1PX)
    const intended = join(dir, '100%off (resized).png')
    magick([src, intended]) // exits 0…
    // …but the intended path was never written: the %o was expanded away.
    expect(existsSync(intended)).toBe(false)
    // Clean whatever it did write so the temp dir teardown stays honest.
    for (const f of readdirSync(dir)) if (f.includes('(resized)')) rmSync(join(dir, f))
  })
})
