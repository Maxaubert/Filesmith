import { describe, expect, it } from 'vitest'
import { detectJson, parseArgv } from '../src/cli/parse'
import { UsageError } from '../src/cli/exit'

const p = (s: string[]): ReturnType<typeof parseArgv> => parseArgv(s)

describe('parseArgv', () => {
  it('verb, inputs and options in any order; both value syntaxes', () => {
    const a = p(['convert', 'a.png', '--to', 'webp', 'b.png', '--quality=best'])
    expect(a.kind).toBe('run')
    expect(a.command?.id).toBe('convert')
    expect(a.positionals).toEqual(['a.png', 'b.png'])
    expect(a.values).toEqual({ to: 'webp', quality: 'best' })
  })

  it('verbs and flag names are case-insensitive; values and paths keep case', () => {
    const a = p(['CONVERT', 'C:\\X\\A.PNG', '--TO', 'WebP'])
    expect(a.command?.id).toBe('convert')
    expect(a.positionals).toEqual(['C:\\X\\A.PNG'])
    expect(a.values.to).toBe('WebP')
  })

  it('aliases: remove-bg, --dpi, --grayscale, --no-<bool>', () => {
    expect(p(['remove-bg', 'x.png']).command?.id).toBe('removebg')
    expect(p(['remove-background', 'x.png']).command?.id).toBe('removebg')
    expect(p(['convert', 'a.pdf', '--to', 'cbz', '--dpi', '200']).values.resolution).toBe('200')
    expect(p(['compress', 'a.pdf', '--grayscale']).values.greyscale).toBe(true)
    expect(p(['compress', 'a.pdf', '--no-greyscale']).values.greyscale).toBe(false)
  })

  it('-o is --out, -h is help', () => {
    expect(p(['resize', 'a.png', '-o', 'D:\\Out']).values.out).toBe('D:\\Out')
    expect(p(['resize', '-h']).kind).toBe('help')
  })

  it('pdf tools nest; a bare pdf is a usage error naming the tools', () => {
    expect(p(['pdf', 'merge', 'a.pdf', 'b.pdf']).command?.id).toBe('pdf merge')
    expect(() => p(['pdf'])).toThrow(/merge, split, burst/)
    expect(() => p(['pdf', 'nope'])).toThrow(UsageError)
    expect(p(['pdf', '--help'])).toMatchObject({ kind: 'help', command: null, group: 'pdf' })
  })

  it('-- ends options: a file named like a flag', () => {
    const a = p(['resize', '--percent', '50', '--', '-x.png', '--json'])
    expect(a.positionals).toEqual(['-x.png', '--json'])
    expect(a.json).toBe(false)
  })

  it('keeps spaces, ampersands and non-ASCII letters in paths byte for byte', () => {
    const path = 'C:\\My Files\\Ä & b (1).png'
    expect(p(['convert', path, '--to', 'webp']).positionals).toEqual([path])
  })

  it('the last of a repeated flag wins', () => {
    expect(p(['convert', 'a', '--to', 'png', '--to', 'webp']).values.to).toBe('webp')
  })

  it('unknown flags name the flag and suggest the closest one', () => {
    expect(() => p(['convert', 'a', '--bogus'])).toThrow(
      /Unknown option --bogus for filesmith convert/
    )
    expect(() => p(['compress', 'a', '--levle', 'x'])).toThrow(/Did you mean --level\?/)
    expect(() => p(['convert', 'a.pdf', '--to', 'png', '--level', 'x'])).toThrow(
      /--level is an option of: compress, pdf compress/
    )
  })

  it('a flag without its value is a usage error', () => {
    expect(() => p(['convert', 'a', '--to'])).toThrow(/--to needs a value/)
  })

  it('help routing at every level', () => {
    expect(p([])).toMatchObject({ kind: 'help', command: null })
    expect(p(['--help'])).toMatchObject({ kind: 'help', command: null })
    expect(p(['help'])).toMatchObject({ kind: 'help', command: null })
    expect(p(['help', 'pdf', 'merge']).command?.id).toBe('pdf merge')
    expect(p(['help', 'pdf'])).toMatchObject({ kind: 'help', group: 'pdf' })
    expect(p(['pdf', 'merge', '--help']).command?.id).toBe('pdf merge')
    expect(() => p(['help', 'nope'])).toThrow(/Unknown command: nope/)
  })

  it('--version anywhere', () => {
    expect(p(['--version']).kind).toBe('version')
    expect(p(['convert', '--version']).kind).toBe('version')
  })

  it('commands without inputs refuse positionals', () => {
    expect(() => p(['doctor', 'extra'])).toThrow(/filesmith doctor takes no arguments/)
  })

  it('unknown commands', () => {
    expect(() => p(['frobnicate'])).toThrow(/Unknown command: frobnicate/)
  })

  it('json and dry-run are read from the parsed flags', () => {
    expect(p(['doctor', '--json'])).toMatchObject({ json: true, dryRun: false })
    expect(p(['resize', 'a.png', '--DRY-RUN'])).toMatchObject({ dryRun: true })
  })
})

describe('detectJson', () => {
  it('finds --json before -- only, case-insensitively', () => {
    expect(detectJson(['convert', '--JSON'])).toBe(true)
    expect(detectJson(['convert', '--', '--json'])).toBe(false)
    expect(detectJson(['convert'])).toBe(false)
  })
})
