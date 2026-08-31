import { describe, expect, it } from 'vitest'
import {
  batchImages,
  buildExtractArgs,
  buildPackArgs,
  buildRarPackArgs,
  naturalSort,
  parse7zProgress
} from '../src/main/tools/archive'

describe('7-Zip arguments', () => {
  it('extracts into a target directory without prompting', () => {
    expect(buildExtractArgs('C:\\in.cbr', 'C:\\tmp\\x')).toEqual([
      'x',
      'C:\\in.cbr',
      '-oC:\\tmp\\x',
      '-y',
      '-bsp2'
    ])
  })

  it('packs the directory contents, not a wrapper folder', () => {
    const args = buildPackArgs('C:\\out.cbz', 'zip', true)
    expect(args).toEqual(['a', '-tzip', '-mx0', 'C:\\out.cbz', '*', '-y', '-bsp2'])
    expect(args).not.toContain('C:\\tmp\\x')
  })

  it('uses normal compression when store is off', () => {
    expect(buildPackArgs('C:\\out.7z', '7z', false)).toContain('-mx5')
  })

  it('builds a WinRAR command that strips the leading path', () => {
    expect(buildRarPackArgs('C:\\out.cbr')).toEqual(['a', '-ep1', '-r', '-y', 'C:\\out.cbr', '.'])
  })
})

describe('parse7zProgress', () => {
  it('reads the percent counter', () => {
    expect(parse7zProgress('  47% 12 - page-012.jpg')).toBe(47)
  })

  it('takes the last percent in a multi-line chunk', () => {
    expect(parse7zProgress(' 10% a\r 62% b\r')).toBe(62)
  })

  it('returns undefined when there is no counter', () => {
    expect(parse7zProgress('Scanning the drive for archives')).toBeUndefined()
  })

  it('clamps a bogus value into range', () => {
    expect(parse7zProgress(' 340% x')).toBe(100)
  })
})

describe('naturalSort', () => {
  it('orders page 2 before page 10', () => {
    expect(naturalSort(['page10.jpg', 'page2.jpg', 'page1.jpg'])).toEqual([
      'page1.jpg',
      'page2.jpg',
      'page10.jpg'
    ])
  })

  it('groups by folder, then by natural page order', () => {
    expect(naturalSort(['b/p2.png', 'a/p10.png', 'a/p2.png'])).toEqual([
      'a/p2.png',
      'a/p10.png',
      'b/p2.png'
    ])
  })
})

describe('batchImages', () => {
  it('keeps one batch when everything fits', () => {
    expect(batchImages(['a.jpg', 'b.jpg'], 1000)).toEqual([['a.jpg', 'b.jpg']])
  })

  it('splits when the joined length exceeds the budget', () => {
    const paths = Array.from({ length: 6 }, (_, i) => `C:\\tmp\\page-${i}.jpg`)
    const batches = batchImages(paths, 40)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.flat()).toEqual(paths)
    for (const b of batches) expect(b.join(' ').length).toBeLessThanOrEqual(40)
  })

  it('never drops a path longer than the whole budget', () => {
    const long = 'C:\\' + 'x'.repeat(100) + '.jpg'
    expect(batchImages([long], 10)).toEqual([[long]])
  })

  it('returns nothing for an empty list', () => {
    expect(batchImages([], 100)).toEqual([])
  })
})
