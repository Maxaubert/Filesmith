import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { findRarIn, resolveSevenZip } from '../src/main/toolResolver'

// Same shape as resolvers.test.ts: real temp fixtures over the filesystem
// rather than fs mocks, because the whole point of these functions is what they
// find on a machine.
const root = mkdtempSync(join(tmpdir(), 'filesmith-rar-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('findRarIn', () => {
  it('returns null when WinRAR is in none of the roots', () => {
    expect(findRarIn([join(root, 'nothing-here')])).toBeNull()
  })

  it('finds Rar.exe under a Program Files root', () => {
    const dir = join(root, 'pf', 'WinRAR')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Rar.exe'), 'x')
    expect(findRarIn([join(root, 'missing'), join(root, 'pf')])).toBe(join(dir, 'Rar.exe'))
  })

  it('takes the first root that has it', () => {
    const first = join(root, 'a', 'WinRAR')
    const second = join(root, 'b', 'WinRAR')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    writeFileSync(join(first, 'Rar.exe'), 'x')
    writeFileSync(join(second, 'Rar.exe'), 'x')
    expect(findRarIn([join(root, 'a'), join(root, 'b')])).toBe(join(first, 'Rar.exe'))
  })

  it('returns null for an empty root list', () => {
    expect(findRarIn([])).toBeNull()
  })
})

describe('resolveSevenZip', () => {
  it('resolves to a 7z command either bundled or on PATH', () => {
    const cmd = resolveSevenZip()
    expect(cmd === '7z' || cmd.endsWith('7z.exe') || cmd.endsWith('7z')).toBe(true)
  })
})
