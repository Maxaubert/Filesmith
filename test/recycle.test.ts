import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  folderStats,
  freeBytesAt,
  moveToRecycleBin,
  tooBigForRecycleBin
} from '../src/main/recycle'

describe('recycle', () => {
  it('folderStats counts bytes and files recursively', () => {
    const d = mkdtempSync(join(tmpdir(), 'fs-rec-'))
    try {
      mkdirSync(join(d, 'sub'))
      writeFileSync(join(d, 'a'), '12345')
      writeFileSync(join(d, 'sub', 'b'), '123')
      expect(folderStats(d)).toEqual({ bytes: 8, files: 2 })
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('the Recycle Bin limit is 5 GB or 5,000 files', () => {
    expect(tooBigForRecycleBin({ bytes: 6 * 1024 ** 3, files: 10 })).toBe(true)
    expect(tooBigForRecycleBin({ bytes: 10, files: 5001 })).toBe(true)
    expect(tooBigForRecycleBin({ bytes: 10, files: 10 })).toBe(false)
  })

  it('freeBytesAt walks up to an existing folder', () => {
    expect(freeBytesAt(join(tmpdir(), 'does', 'not', 'exist'))).toBeGreaterThan(0)
  })

  // Puts a file in this machine's Recycle Bin, so it only runs on request.
  it.skipIf(!process.env.FILESMITH_TEST_RECYCLE)('moves a file to the Recycle Bin', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'fs-rec-')), 'recycle me.txt')
    writeFileSync(f, 'x')
    await moveToRecycleBin(f)
    expect(existsSync(f)).toBe(false)
  })
})
