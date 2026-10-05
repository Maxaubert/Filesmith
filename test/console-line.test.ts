import { describe, expect, it } from 'vitest'
import {
  classifyLine,
  codeSegments,
  cliVerbs,
  MAX_LINE,
  refusalText,
  splitAtCaret,
  tokenize
} from '../src/shared/consoleLine'
import type { ConsoleCatalog } from '../src/shared/console'

const cat: ConsoleCatalog = {
  commands: [
    { path: ['convert'], summary: '', inputs: 'files', flags: [] },
    { path: ['pdf', 'merge'], summary: '', inputs: 'files', flags: [] },
    { path: ['doctor'], summary: '', inputs: 'none', flags: [] }
  ],
  aliases: { 'remove-bg': 'removebg' },
  globals: []
}
const verbs = cliVerbs(cat)

describe('tokenize', () => {
  it('splits on whitespace and keeps metacharacters as plain words', () => {
    expect(tokenize('convert *.png --to webp & del *.*')).toEqual([
      'convert',
      '*.png',
      '--to',
      'webp',
      '&',
      'del',
      '*.*'
    ])
  })
  it('groups double quotes and keeps backslashes literal', () => {
    expect(tokenize('convert "D:\\My Photos\\*.png" --out C:\\')).toEqual([
      'convert',
      'D:\\My Photos\\*.png',
      '--out',
      'C:\\'
    ])
  })
  it('keeps an empty quoted word and runs an unclosed quote to the end', () => {
    expect(tokenize('a "" b')).toEqual(['a', '', 'b'])
    expect(tokenize('a "b c')).toEqual(['a', 'b c'])
  })
})

describe('splitAtCaret', () => {
  it('returns the finished words and the word being typed', () => {
    expect(splitAtCaret('convert *.heic --')).toEqual({ done: ['convert', '*.heic'], cur: '--' })
    expect(splitAtCaret('convert ')).toEqual({ done: ['convert'], cur: '' })
    expect(splitAtCaret('convert "My Ph')).toEqual({ done: ['convert'], cur: 'My Ph' })
  })
})

describe('classifyLine', () => {
  it('runs CLI commands, strips a pasted filesmith prefix, any case', () => {
    expect(classifyLine('convert a.png --to webp', verbs)).toEqual({
      kind: 'cli',
      argv: ['convert', 'a.png', '--to', 'webp']
    })
    expect(classifyLine('filesmith Doctor', verbs)).toEqual({ kind: 'cli', argv: ['Doctor'] })
    expect(classifyLine('FILESMITH.EXE doctor', verbs)).toEqual({ kind: 'cli', argv: ['doctor'] })
    expect(classifyLine('filesmith.cmd doctor', verbs)).toEqual({ kind: 'cli', argv: ['doctor'] })
    expect(classifyLine('filesmith', verbs)).toEqual({ kind: 'cli', argv: ['--help'] })
    expect(classifyLine('remove-bg a.png', verbs).kind).toBe('cli')
    expect(classifyLine('pdf merge a.pdf b.pdf', verbs).kind).toBe('cli')
    expect(classifyLine('--version', verbs)).toEqual({ kind: 'cli', argv: ['--version'] })
    expect(classifyLine('--json doctor', verbs)).toEqual({
      kind: 'cli',
      argv: ['--json', 'doctor']
    })
  })
  it('knows the built-ins; help <command> goes to the CLI', () => {
    expect(classifyLine('  ', verbs)).toEqual({ kind: 'empty' })
    expect(classifyLine('cls', verbs)).toEqual({ kind: 'builtin', name: 'clear', args: [] })
    expect(classifyLine('cd ..', verbs)).toEqual({ kind: 'builtin', name: 'cd', args: ['..'] })
    expect(classifyLine('help', verbs)).toEqual({ kind: 'builtin', name: 'help', args: [] })
    expect(classifyLine('history', verbs)).toEqual({ kind: 'builtin', name: 'history', args: [] })
    expect(classifyLine('help convert', verbs)).toEqual({
      kind: 'cli',
      argv: ['convert', '--help']
    })
    expect(classifyLine('filesmith help convert', verbs)).toEqual({
      kind: 'cli',
      argv: ['help', 'convert']
    })
  })
  it('refuses other programs, stdin input and over-long lines', () => {
    expect(classifyLine('del *.*', verbs)).toEqual({
      kind: 'refuse',
      word: 'del',
      reason: 'unknown'
    })
    // Programs, paths, operators and tricks around the prefix never pass.
    for (const l of [
      'calc',
      'cmd /c del *.*',
      'powershell -c x',
      'C:\\Windows\\System32\\calc.exe',
      '.\\convert.exe',
      '"convert.exe" a.png',
      '& convert a.png',
      '| doctor',
      '"" doctor',
      'filesmith del *.*',
      'filesmith filesmith doctor',
      'filesmith cd ..',
      '--json calc',
      'convert.cmd a.png',
      '%COMSPEC%',
      '$(calc)'
    ])
      expect(classifyLine(l, verbs).kind, l).toBe('refuse')
    expect(classifyLine('convert - --to webp', verbs)).toEqual({
      kind: 'refuse',
      word: '-',
      reason: 'stdin'
    })
    expect(classifyLine(42 as unknown as string, verbs).kind).toBe('refuse')
    expect(classifyLine(`convert ${'a'.repeat(MAX_LINE)}`, verbs).kind).toBe('refuse')
  })
  it('words the refusals', () => {
    expect(refusalText({ kind: 'refuse', word: 'del', reason: 'unknown' })).toBe(
      '`del` is not a filesmith command. This console only runs filesmith; use a terminal for anything else.'
    )
    expect(refusalText({ kind: 'refuse', word: '-', reason: 'stdin' })).toBe(
      'Reading file names from stdin is not available here. Use Open in terminal.'
    )
  })
})

describe('codeSegments', () => {
  it('marks backtick spans as code', () => {
    expect(codeSegments('`calc` is not a filesmith command.')).toEqual([
      { text: 'calc', code: true },
      { text: ' is not a filesmith command.', code: false }
    ])
  })
  it('leaves plain text and an unmatched backtick alone', () => {
    expect(codeSegments('plain')).toEqual([{ text: 'plain', code: false }])
    expect(codeSegments('a ` b')).toEqual([{ text: 'a ` b', code: false }])
    expect(codeSegments('')).toEqual([])
  })
})
