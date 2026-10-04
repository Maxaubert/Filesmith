import { describe, expect, it } from 'vitest'
import { CliError, EXIT, UsageError, reduceExit } from '../src/cli/exit'

describe('reduceExit', () => {
  const c = (ok: number, failed: number, skipped: number, canceled: number) => ({
    ok,
    failed,
    skipped,
    canceled
  })
  it.each([
    [c(3, 0, 0, 0), 0],
    [c(0, 0, 2, 0), 0],
    [c(2, 1, 0, 0), 1],
    [c(1, 1, 0, 1), 130],
    [c(0, 0, 0, 0), 0]
  ])('%j -> %i', (counts, code) => expect(reduceExit(counts)).toBe(code))
})

describe('errors', () => {
  it('UsageError is a CliError with code USAGE and the command path', () => {
    const e = new UsageError('bad', ['pdf', 'split'])
    expect(e).toBeInstanceOf(CliError)
    expect(e.code).toBe('USAGE')
    expect(e.commandPath).toEqual(['pdf', 'split'])
    expect(EXIT.USAGE).toBe(2)
  })
})
