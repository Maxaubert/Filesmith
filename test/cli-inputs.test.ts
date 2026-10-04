import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expandInputs, type ExpandOptions } from '../src/cli/inputs'
import { fileInfoFromPath } from '../src/main/fileInfo'

let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'fs-inputs-'))
  for (const f of [
    'a.png',
    'b10.png',
    'b2.png',
    'Photo.JPG',
    'img[1].png',
    'notes.txt',
    '.hidden.png',
    'Thumbs.db'
  ])
    writeFileSync(join(root, f), 'x')
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'sub', 'c.png'), 'x')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const opts = (over: Partial<ExpandOptions> = {}): ExpandOptions => ({
  cwd: root,
  recursive: false,
  accepts: (f) => f.kind === 'image',
  fileInfo: fileInfoFromPath,
  readStdin: async () => '',
  ...over
})
const at = (...p: string[]): string => join(root, ...p)

describe('expandInputs', () => {
  it('a literal file, even one whose name looks like a glob', async () => {
    const r = await expandInputs(['a.png', 'img[1].png'], opts())
    expect(r.files).toEqual([at('a.png'), at('img[1].png')])
  })

  it('a folder takes its own accepted files in natural order; others are skipped, hidden ignored', async () => {
    const r = await expandInputs(['.'], opts())
    expect(r.files).toEqual([
      at('a.png'),
      at('b2.png'),
      at('b10.png'),
      at('img[1].png'),
      at('Photo.JPG')
    ])
    expect(r.skipped.map((s) => s.path)).toEqual([at('notes.txt')])
    expect(r.issues).toEqual([])
  })

  it('--recursive descends', async () => {
    const r = await expandInputs([root], opts({ recursive: true }))
    expect(r.files).toContain(at('sub', 'c.png'))
  })

  it('globs: case-insensitive, backslashes, absolute, ** recursive', async () => {
    expect((await expandInputs(['*.jpg'], opts())).files).toEqual([at('Photo.JPG')])
    expect((await expandInputs([`${root}\\sub\\*.png`], opts())).files).toEqual([
      at('sub', 'c.png')
    ])
    const all = (await expandInputs(['**/*.png'], opts())).files
    expect(all).toContain(at('sub', 'c.png'))
    expect(all).not.toContain(at('.hidden.png'))
  })

  it('no match and not found are per-argument issues', async () => {
    const r = await expandInputs(['*.webp', 'missing.png'], opts())
    expect(r.files).toEqual([])
    expect(r.issues.map((i) => i.code)).toEqual(['NO_MATCH', 'NOT_FOUND'])
  })

  it('de-duplicates case-insensitively and keeps first-seen order', async () => {
    const r = await expandInputs(['b2.png', 'A.PNG', '*.png'], opts())
    expect(r.files).toEqual([at('b2.png'), at('A.PNG'), at('b10.png'), at('img[1].png')])
  })

  it('- reads paths from stdin, one per line', async () => {
    const r = await expandInputs(
      ['-'],
      opts({ readStdin: async () => 'a.png\r\n\r\nsub\\c.png\n' })
    )
    expect(r.files).toEqual([at('a.png'), at('sub', 'c.png')])
    const empty = await expandInputs(['-'], opts())
    expect(empty).toEqual({ files: [], issues: [], skipped: [] })
  })
})
