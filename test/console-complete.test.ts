import { describe, expect, it } from 'vitest'
import { COMMANDS } from '../src/cli/catalog'
import { buildConsoleCatalog } from '../src/main/console/catalog'
import { applyCompletion, completionContext, fileItems } from '../src/shared/consoleComplete'

const cat = buildConsoleCatalog(COMMANDS)
const B = [{ value: 'clear', detail: 'clear the console (Ctrl+L)' }]
const values = (before: string): string[] => {
  const c = completionContext(before, cat, B)
  return c && c.kind === 'list' ? c.items.map((i) => i.value) : []
}

describe('buildConsoleCatalog', () => {
  it('copies every CLI command with its flags and adds aliases and globals', () => {
    expect(cat.commands.map((c) => c.path.join(' '))).toEqual(COMMANDS.map((c) => c.path.join(' ')))
    const to = cat.commands[0].flags.find((f) => f.name === 'to')!
    expect(to.values).toContain('webp')
    expect(cat.aliases['remove-bg']).toBe('removebg')
    expect(cat.globals.map((g) => g.name)).toEqual(['json', 'dry-run', 'help'])
    expect(JSON.parse(JSON.stringify(cat))).toEqual(cat)
  })
})

describe('completionContext', () => {
  it('first word: commands and built-ins by prefix', () => {
    expect(values('conv')).toEqual(['convert'])
    expect(values('c')).toEqual(['convert', 'compress', 'clear'])
    expect(completionContext('', cat, B)).toMatchObject({ kind: 'list', title: 'COMMANDS' })
  })
  it('after pdf: the pdf tools', () => {
    expect(values('pdf ')).toContain('merge')
    expect(completionContext('pdf m', cat, B)).toMatchObject({ title: 'PDF TOOLS', prefix: 'm' })
  })
  it('flags of the command, minus those already used, plus globals', () => {
    const v = values('convert a.png --to webp --')
    expect(v).not.toContain('--to')
    expect(v).toContain('--quality')
    expect(v).toContain('--dry-run')
    expect(completionContext('convert --q', cat, B)).toMatchObject({ title: 'CONVERT OPTIONS' })
  })
  it('values after a flag with values; an alias works', () => {
    expect(values('convert a.heic --to web')).toContain('webp')
    expect(values('convert a.heic --to web')).not.toContain('png')
    expect(completionContext('convert a --to ', cat, B)).toMatchObject({ title: 'TO' })
    expect(values('remove-bg a.png --')).toContain('--fill')
  })
  it('files for a file-taking command, with the typed sub-folder', () => {
    expect(completionContext('convert sub\\IMG', cat, B)).toEqual({
      kind: 'files',
      prefix: 'sub\\IMG',
      start: 8,
      dir: 'sub\\',
      name: 'IMG'
    })
    expect(completionContext('doctor x', cat, B)).toBeNull()
    expect(completionContext('del x', cat, B)).toBeNull()
  })
})

describe('fileItems and applyCompletion', () => {
  it('folders first with a trailing backslash, then files with sizes', () => {
    const items = fileItems(
      [
        { name: 'b.png', dir: false, size: 10 },
        { name: 'Album', dir: true, size: 0 },
        { name: 'x.png', dir: false, size: 1 }
      ],
      'a',
      (n) => `${n} B`
    )
    expect(items).toEqual([{ value: 'Album\\', detail: 'folder' }])
  })
  it('replaces the typed word, quotes spaces, adds a space unless a folder', () => {
    expect(applyCompletion('convert *.heic --t', 18, 15, '--to')).toEqual({
      text: 'convert *.heic --to ',
      caret: 20
    })
    expect(applyCompletion('convert My', 10, 8, 'My Photos\\')).toEqual({
      text: 'convert "My Photos\\',
      caret: 19
    })
    expect(applyCompletion('conv rest', 4, 0, 'convert')).toEqual({
      text: 'convert rest',
      caret: 8
    })
  })
  it('replaces a whole quoted word, quotes included', () => {
    const t = 'convert "My Photos"'
    const ctx = completionContext(t, cat, B)
    expect(ctx).toMatchObject({ kind: 'files', prefix: 'My Photos', start: 8 })
    expect(applyCompletion(t, t.length, 8, 'My Photos\\')).toEqual({
      text: 'convert "My Photos\\',
      caret: 19
    })
    const t2 = 'convert My" "Photos'
    const c2 = completionContext(t2, cat, B)
    expect(c2).toMatchObject({ kind: 'files', prefix: 'My Photos', start: 8 })
    expect(applyCompletion(t2, t2.length, 8, 'My Photos.png')).toEqual({
      text: 'convert "My Photos.png" ',
      caret: 24
    })
  })
  it('keeps one opening quote for an unfinished quoted word', () => {
    const t = 'convert "My Ph'
    const ctx = completionContext(t, cat, B)
    expect(ctx).toMatchObject({ kind: 'files', prefix: 'My Ph', start: 8 })
    expect(applyCompletion(t, t.length, 8, 'My Photos.png')).toEqual({
      text: 'convert "My Photos.png" ',
      caret: 24
    })
  })
  it('completes a word in the middle of the line', () => {
    const t = 'convert a.png --t --json'
    const before = t.slice(0, 17)
    const ctx = completionContext(before, cat, B)
    expect(ctx).toMatchObject({ kind: 'list', prefix: '--t', start: 14 })
    expect(applyCompletion(t, 17, 14, '--to')).toEqual({
      text: 'convert a.png --to --json',
      caret: 19
    })
  })
})

describe('completionContext prefix and global flags', () => {
  it.each(['filesmith ', 'filesmith.exe ', 'FILESMITH.CMD ', 'filesmith --json ', '--dry-run '])(
    'completes the verb after %j',
    (pre) => {
      expect(values(`${pre}conv`)).toEqual(['convert'])
      expect(values(`${pre}pdf `)).toContain('merge')
    }
  )
})
