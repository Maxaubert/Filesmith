import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { hasRecycleBin } from '../src/main/recycle'
import {
  canReplace,
  finishOptions,
  finishOptionsFor,
  finishOutput,
  planFinish,
  type FinishOptions
} from '../src/main/finishOutput'
import { renderOutputName } from '../src/shared/outputNaming'
import { stripArgs } from '../src/main/tools/convert'
import { buildResizeArgs } from '../src/main/tools/resize'
import { buildMagickCompressArgs, buildVideoCompressArgs } from '../src/main/tools/compress'
import { pushRecent } from '../src/renderer/src/components/options/recentFolders'

// Rename / Replace originals / Keep dates (2026-10-26). Replace is the one
// owner-approved exception to never-overwrite, so its safety is pinned here:
// the original only ever goes to the Recycle Bin, and only after the new file
// exists.

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'filesmith-finish-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const NOW = new Date(2026, 9, 26)
const fo = (o: Partial<FinishOptions>): FinishOptions => ({
  replace: false,
  rename: null,
  keepDates: false,
  seq: 1,
  ...o
})
const file = (name: string, body = name): string => {
  const p = join(dir, name)
  writeFileSync(p, body)
  return p
}
/** A fake Recycle Bin: records and removes, like the real one. */
const bin = (): { trash: (p: string) => Promise<void>; got: string[] } => {
  const got: string[] = []
  return {
    got,
    trash: async (p) => {
      got.push(p)
      rmSync(p)
    }
  }
}

describe('renderOutputName', () => {
  it('fills the tokens', () => {
    expect(renderOutputName('{name}-web', 'beach', 1, NOW)).toBe('beach-web')
    expect(renderOutputName('{date} {name} {n}', 'beach', 3, NOW)).toBe('2026-10-26 beach 3')
  })
  it('replaces characters Windows forbids and falls back when empty', () => {
    expect(renderOutputName('a:b/c', 'x', 1, NOW)).toBe('a_b_c')
    expect(renderOutputName('...', 'beach', 1, NOW)).toBe('beach')
    expect(renderOutputName('  ', 'beach', 1, NOW)).toBe('beach')
  })
})

describe('finishOptions', () => {
  it('rename needs both the box and a pattern, and Replace switches it off', () => {
    expect(finishOptions({ rename: true, renamePattern: '{name}-x' }).rename).toBe('{name}-x')
    expect(finishOptions({ rename: true, renamePattern: '  ' }).rename).toBeNull()
    expect(finishOptions({ rename: false, renamePattern: '{name}' }).rename).toBeNull()
    expect(
      finishOptions({ replaceOriginals: true, rename: true, renamePattern: '{name}-x' }).rename
    ).toBeNull()
  })
  it('defaults: nothing on, seq 1', () => {
    expect(finishOptions({})).toEqual({ replace: false, rename: null, keepDates: false, seq: 1 })
  })
  it('tools without the options ignore values left in the options bag', () => {
    const o = { replaceOriginals: true, rename: true, renamePattern: 'x', keepDates: true }
    expect(finishOptionsFor('archive', o)).toMatchObject({
      replace: false,
      rename: null,
      keepDates: false
    })
    expect(finishOptionsFor('convert', o).replace).toBe(true)
    expect(canReplace('archive', {})).toBe(false)
  })
  it('merge and generate cannot replace', () => {
    expect(canReplace('convert', {})).toBe(true)
    expect(canReplace('pdf', { mergeInputs: ['a', 'b'] })).toBe(false)
    expect(canReplace('generate', {})).toBe(false)
  })
})

describe('finishOutput', () => {
  it('does nothing when no option is on', async () => {
    const out = file('beach.jxl')
    expect(await finishOutput(file('beach.png'), out, fo({}), true, bin().trash)).toEqual({
      path: out
    })
  })

  it('renames, and a taken name gets (2)', async () => {
    const src = file('beach.png')
    file('beach-web.jxl', 'someone else')
    const out = file('beach.jxl', 'new')
    const r = await finishOutput(src, out, fo({ rename: '{name}-web' }), true, bin().trash, NOW)
    expect(r.path).toBe(join(dir, 'beach-web (2).jxl'))
    expect(readFileSync(r.path, 'utf8')).toBe('new')
    expect(readFileSync(join(dir, 'beach-web.jxl'), 'utf8')).toBe('someone else')
    expect(existsSync(out)).toBe(false)
  })

  it('replace: the original goes to the bin, the new file takes its name', async () => {
    const src = file('beach.png', 'old')
    const out = file('beach (compressed).png', 'new')
    const b = bin()
    const r = await finishOutput(src, out, fo({ replace: true }), true, b.trash)
    expect(b.got).toEqual([src])
    expect(r.path).toBe(src)
    expect(readFileSync(src, 'utf8')).toBe('new')
    expect(existsSync(out)).toBe(false)
  })

  it('replace across formats keeps the new extension', async () => {
    const src = file('beach.png')
    const out = file('beach.jxl', 'new')
    const r = await finishOutput(src, out, fo({ replace: true }), true, bin().trash)
    expect(r.path).toBe(out)
    expect(existsSync(src)).toBe(false)
  })

  it('a failed recycle keeps the original and says so', async () => {
    const src = file('beach.png', 'old')
    const out = file('beach (compressed).png', 'new')
    const r = await finishOutput(src, out, fo({ replace: true }), true, async () => {
      throw new Error('access denied')
    })
    expect(r).toEqual({ path: out, note: 'Original kept: access denied' })
    expect(readFileSync(src, 'utf8')).toBe('old')
  })

  it('a drive without a Recycle Bin keeps the original', async () => {
    const src = file('beach.png', 'old')
    const out = file('beach (compressed).png', 'new')
    const b = bin()
    const r = await finishOutput(
      src,
      out,
      fo({ replace: true }),
      true,
      b.trash,
      NOW,
      async () => false
    )
    expect(r).toEqual({ path: out, note: 'Original kept: this drive has no Recycle Bin.' })
    expect(b.got).toEqual([])
    expect(readFileSync(src, 'utf8')).toBe('old')
  })

  it('network shares never count as having a Recycle Bin; the system drive does', async () => {
    expect(await hasRecycleBin('\\\\server\\share\\a.png')).toBe(false)
    expect(await hasRecycleBin(join(dir, 'a.png'))).toBe(true)
  })

  it('replace is ignored where it is not allowed', async () => {
    const src = file('a.pdf')
    const out = file('a (merged).pdf')
    const b = bin()
    expect((await finishOutput(src, out, fo({ replace: true }), false, b.trash)).path).toBe(out)
    expect(b.got).toEqual([])
  })

  it('keeps the source date', async () => {
    const src = file('beach.png')
    const old = new Date(2020, 0, 2, 3, 4, 5)
    utimesSync(src, old, old)
    const out = file('beach.jxl')
    await finishOutput(src, out, fo({ keepDates: true }), true, bin().trash)
    expect(Math.abs(statSync(out).mtimeMs - old.getTime())).toBeLessThan(2000)
  })
})

describe('planFinish', () => {
  it('predicts rename, replace and clashes in one run', () => {
    const src = join(dir, 'beach.png')
    const planned = { path: join(dir, 'beach (compressed).png'), kind: 'file' as const }
    const claimed = new Set<string>([planned.path.toLowerCase()])
    expect(planFinish(src, planned, fo({ replace: true }), true, claimed)).toBe(src)
    const p2 = { path: join(dir, 'dog.jxl'), kind: 'file' as const }
    const one = planFinish(join(dir, 'dog.png'), p2, fo({ rename: 'x' }), true, claimed, NOW)
    const two = planFinish(join(dir, 'cat.png'), p2, fo({ rename: 'x' }), true, claimed, NOW)
    expect([one, two]).toEqual([join(dir, 'x.jxl'), join(dir, 'x (2).jxl')])
  })
  it('leaves folder outputs alone', () => {
    const d = { path: join(dir, 'a (pages)'), kind: 'dir' as const }
    expect(planFinish(join(dir, 'a.pdf'), d, fo({ rename: 'x' }), true, new Set())).toBe(d.path)
  })
})

describe('Remove photo metadata', () => {
  it('images get -strip, video drops container metadata, audio keeps its tags', () => {
    expect(stripArgs('image', true)).toEqual(['-auto-orient', '-strip'])
    expect(stripArgs('video', true)).toEqual(['-map_metadata', '-1'])
    expect(stripArgs('audio', true)).toEqual([])
    expect(stripArgs('image', false)).toEqual([])
  })
  it('reaches every image and video builder', () => {
    expect(buildResizeArgs('a.png', 'b.png', '50%', false, true)).toContain('-strip')
    expect(buildMagickCompressArgs('a.png', 'b.webp', 80, true)).toContain('-strip')
    expect(buildResizeArgs('a.png', 'b.png', '50%', false, true).slice(0, 3)).toEqual([
      'a.png',
      '-auto-orient',
      '-resize'
    ])
    const v = buildVideoCompressArgs('a.mp4', 'b.mp4', {
      codec: 'h264',
      quality: 60,
      scale: 100,
      strip: true
    })
    expect(v.slice(-3)).toEqual(['-map_metadata', '-1', 'b.mp4'])
  })
})

describe('recent folders', () => {
  it('newest first, no duplicates (any case), at most 5', () => {
    let l: string[] = []
    for (const p of ['A', 'B', 'C', 'D', 'E', 'F']) l = pushRecent(l, p)
    expect(l).toEqual(['F', 'E', 'D', 'C', 'B'])
    expect(pushRecent(l, 'c')).toEqual(['c', 'F', 'E', 'D', 'B'])
  })
})
