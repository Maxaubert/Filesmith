import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
import { join } from 'path'
import {
  discardAllOutputs,
  PART_MARK,
  reserveOutput,
  reserveOutputDir,
  reserveOutputInDir
} from '../src/main/atomicOutput'

// Atomic outputs: a tool writes a `.filesmith-part` sibling and only a
// successful job renames it onto the reserved name. A failed or canceled job
// must leave neither the part nor the final name; collision naming is the same
// as before, and the commit never replaces anything but our own placeholder.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'filesmith-atomic-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const ls = (): string[] => readdirSync(dir).sort()

describe('FileOutput', () => {
  it('reserves the same final name as before and writes a part next to it', () => {
    writeFileSync(join(dir, 'clip.mp4'), 'unrelated')
    const out = reserveOutput(join(dir, 'clip.mkv'), '.mp4', 'compressed')
    expect(out.path).toBe(join(dir, 'clip (compressed).mp4'))
    // The extension stays last: ffmpeg and magick pick the format from it.
    expect(out.part).toBe(join(dir, `clip (compressed)${PART_MARK}.mp4`))
    expect(statSync(out.path).size).toBe(0) // the placeholder holds the name
    out.discard()
  })

  it('success leaves only the final file, with the bytes the tool wrote', () => {
    const out = reserveOutput(join(dir, 'a.png'), '.webp', 'converted')
    writeFileSync(out.part, 'webp bytes')
    expect(out.commit()).toBe(join(dir, 'a.webp'))
    expect(ls()).toEqual(['a.webp'])
    expect(readFileSync(join(dir, 'a.webp'), 'utf8')).toBe('webp bytes')
  })

  it('failure or cancel leaves neither the part nor the final name', () => {
    writeFileSync(join(dir, 'a.png'), 'source')
    const out = reserveOutput(join(dir, 'a.png'), '.png', 'resized')
    writeFileSync(out.part, 'half a file')
    out.discard()
    expect(ls()).toEqual(['a.png'])
    expect(readFileSync(join(dir, 'a.png'), 'utf8')).toBe('source')
  })

  it('a commit with no part file throws and cleans up', () => {
    const out = reserveOutput(join(dir, 'a.png'), '.webp', 'converted')
    expect(() => out.commit()).toThrow(/wrote no output/)
    expect(ls()).toEqual([])
  })

  it('never replaces a file that took over the reserved name meanwhile', () => {
    const out = reserveOutput(join(dir, 'a.png'), '.webp', 'converted')
    // Another program writes real content over our empty placeholder.
    rmSync(out.path)
    writeFileSync(out.path, 'someone else')
    writeFileSync(out.part, 'ours')
    const final = out.commit()
    expect(final).toBe(join(dir, 'a (converted).webp'))
    expect(readFileSync(join(dir, 'a.webp'), 'utf8')).toBe('someone else')
    expect(readFileSync(final, 'utf8')).toBe('ours')
    expect(ls()).toEqual(['a (converted).webp', 'a.webp'])
  })

  it('does not delete a file that replaced the placeholder when discarding', () => {
    const out = reserveOutput(join(dir, 'a.png'), '.webp', 'converted')
    rmSync(out.path)
    writeFileSync(out.path, 'someone else')
    out.discard()
    expect(readFileSync(join(dir, 'a.webp'), 'utf8')).toBe('someone else')
  })

  it('skips, and never touches, a part leftover from an earlier crashed run', () => {
    writeFileSync(join(dir, `a${PART_MARK}.webp`), 'old leftover')
    const out = reserveOutput(join(dir, 'a.png'), '.webp', 'converted')
    expect(out.part).toBe(join(dir, `a${PART_MARK}-2.webp`))
    out.discard()
    expect(readFileSync(join(dir, `a${PART_MARK}.webp`), 'utf8')).toBe('old leftover')
  })

  it('concurrent reservations get distinct names and parts', () => {
    const a = reserveOutput(join(dir, 'x.png'), '.jpg', 'converted')
    const b = reserveOutput(join(dir, 'x.png'), '.jpg', 'converted')
    expect(a.path).not.toBe(b.path)
    expect(a.part).not.toBe(b.part)
    writeFileSync(a.part, 'a')
    writeFileSync(b.part, 'b')
    expect(readFileSync(b.commit(), 'utf8')).toBe('b')
    expect(readFileSync(a.commit(), 'utf8')).toBe('a')
    expect(ls()).toEqual(['x (converted).jpg', 'x.jpg'])
  })

  it('reserveOutputInDir names like reserveFileInDir (generate)', () => {
    const out = reserveOutputInDir(dir, 'a-cat', '.png', 'generated')
    expect(out.path).toBe(join(dir, 'a-cat.png'))
    writeFileSync(out.part, 'png')
    out.commit()
    const again = reserveOutputInDir(dir, 'a-cat', '.png', 'generated')
    expect(again.path).toBe(join(dir, 'a-cat (generated).png'))
    again.discard()
  })

  it('discardAllOutputs removes only what this process left uncommitted', () => {
    writeFileSync(join(dir, 'keep.txt'), 'user file')
    const done = reserveOutput(join(dir, 'a.png'), '.webp', 'converted')
    writeFileSync(done.part, 'x')
    done.commit()
    const open = reserveOutput(join(dir, 'b.png'), '.webp', 'converted')
    writeFileSync(open.part, 'half')
    expect(discardAllOutputs()).toBeGreaterThanOrEqual(1)
    expect(ls()).toEqual(['a.webp', 'keep.txt'])
  })
})

describe('DirOutput', () => {
  it('names folders like uniqueOutDir and swaps the filled part in', () => {
    mkdirSync(join(dir, 'doc (split)'))
    const out = reserveOutputDir(dir, 'doc (split)')
    expect(out.path).toBe(join(dir, 'doc (split) (2)'))
    expect(out.part).toBe(join(dir, `doc (split) (2)${PART_MARK}`))
    writeFileSync(join(out.part, 'doc-1.pdf'), 'p1')
    expect(out.commit()).toBe(join(dir, 'doc (split) (2)'))
    expect(ls()).toEqual(['doc (split)', 'doc (split) (2)'])
    expect(readdirSync(join(dir, 'doc (split) (2)'))).toEqual(['doc-1.pdf'])
  })

  it('failure leaves neither folder', () => {
    const out = reserveOutputDir(dir, 'doc (pages)')
    writeFileSync(join(out.part, 'page-1.png'), 'x')
    out.discard()
    expect(ls()).toEqual([])
  })

  it('never merges into a reserved folder someone filled meanwhile', () => {
    const out = reserveOutputDir(dir, 'a (extracted)')
    writeFileSync(join(out.path, 'theirs.txt'), 'not ours')
    writeFileSync(join(out.part, 'ours.txt'), 'ours')
    const final = out.commit()
    expect(final).toBe(join(dir, 'a (extracted) (2)'))
    expect(readdirSync(join(dir, 'a (extracted)'))).toEqual(['theirs.txt'])
    expect(readdirSync(final)).toEqual(['ours.txt'])
    expect(existsSync(out.part)).toBe(false)
  })
})
