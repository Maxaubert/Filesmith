import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { sweepStaleTempDirs } from '../src/main/boot'

describe('sweepStaleTempDirs', () => {
  it('removes only filesmith- dirs older than an hour', () => {
    const root = mkdtempSync(join(tmpdir(), 'fs-sweep-'))
    try {
      const old = join(root, 'filesmith-old')
      const fresh = join(root, 'filesmith-fresh')
      const other = join(root, 'someone-else')
      for (const d of [old, fresh, other]) mkdirSync(d)
      const now = Date.now()
      const twoHoursAgo = (now - 2 * 60 * 60 * 1000) / 1000
      utimesSync(old, twoHoursAgo, twoHoursAgo)
      utimesSync(other, twoHoursAgo, twoHoursAgo)
      sweepStaleTempDirs(now, root)
      expect(existsSync(old)).toBe(false)
      expect(existsSync(fresh)).toBe(true)
      expect(existsSync(other)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
