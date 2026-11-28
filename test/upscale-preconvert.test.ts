// The upscalers normalise every input through the bundled ImageMagick before
// handing it on. The arg builder is pure; the live block SPAWNS magick, so it is
// skipped when resources/bin has not been populated (CI, a fresh clone).
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildPreConvertArgs } from '../src/main/tools/upscale'

describe('buildPreConvertArgs', () => {
  it('reads frame 0 and writes the output, without orienting by default', () => {
    expect(buildPreConvertArgs('C:\\in\\a.jpg', 'C:\\t\\src.png')).toEqual([
      'C:\\in\\a.jpg[0]',
      'C:\\t\\src.png'
    ])
  })

  it('adds -auto-orient between input and output only when asked', () => {
    expect(buildPreConvertArgs('a.jpg', 'o.png', { orient: true })).toEqual([
      'a.jpg[0]',
      '-auto-orient',
      'o.png'
    ])
    expect(buildPreConvertArgs('a.jpg', 'o.png', { orient: false })).not.toContain('-auto-orient')
  })

  it('escapes % in the input path', () => {
    expect(buildPreConvertArgs('C:\\100% done\\a.webp', 'o.png', { orient: true })[0]).toBe(
      'C:\\100%% done\\a.webp[0]'
    )
  })
})

// FILESMITH_TEST_MAGICK points a worktree (whose resources/bin is empty) at a
// populated checkout's magick.exe.
const MAGICK = process.env.FILESMITH_TEST_MAGICK ?? resolve('resources/bin/magick.exe')

/** Splice a minimal EXIF block with Orientation = `value` into a JPEG. */
function withExifOrientation(jpeg: Buffer, value: number): Buffer {
  const tiff = Buffer.alloc(26)
  tiff.write('MM', 0, 'latin1')
  tiff.writeUInt16BE(0x2a, 2)
  tiff.writeUInt32BE(8, 4) // first IFD offset
  tiff.writeUInt16BE(1, 8) // one entry
  tiff.writeUInt16BE(0x0112, 10) // Orientation
  tiff.writeUInt16BE(3, 12) // SHORT
  tiff.writeUInt32BE(1, 14) // count
  tiff.writeUInt16BE(value, 18)
  tiff.writeUInt32BE(0, 22) // no next IFD
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const head = Buffer.from([0xff, 0xe1, 0, 0])
  head.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([jpeg.subarray(0, 2), head, payload, jpeg.subarray(2)])
}

describe.skipIf(!existsSync(MAGICK))('pre-convert with the bundled magick', () => {
  const root = mkdtempSync(join(tmpdir(), 'fs-preconv-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const identify = (p: string, fmt: string): string =>
    execFileSync(MAGICK, ['identify', '-format', fmt, p], { encoding: 'utf8' }).trim()

  it('applies the EXIF orientation of a JPEG to the pixels', () => {
    const plain = join(root, 'plain.jpg')
    execFileSync(MAGICK, ['-size', '40x20', 'xc:gray', plain])
    const rotated = join(root, 'portrait 100%.jpg')
    writeFileSync(rotated, withExifOrientation(readFileSync(plain), 6))
    // Precondition: the fixture is a landscape frame tagged "rotate 90".
    expect(identify(rotated, '%wx%h %[orientation]')).toBe('40x20 RightTop')

    const out = join(root, 'src.png')
    execFileSync(MAGICK, buildPreConvertArgs(rotated, out, { orient: true }))
    expect(identify(out, '%wx%h')).toBe('20x40')
  })
})
