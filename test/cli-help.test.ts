import { describe, expect, it } from 'vitest'
import { COMMANDS, findCommand } from '../src/cli/catalog'
import { renderGroupHelp, renderHelp, renderRootHelp, wrap } from '../src/cli/help'

describe('help', () => {
  it('compress help: usage, grouped options with values and defaults, examples', () => {
    const h = renderHelp(findCommand(['compress'])!)
    expect(h.startsWith('Usage: filesmith compress <files...> [options]\n')).toBe(true)
    expect(h).toContain('\nIMAGE:\n')
    expect(h).toContain('--quality <10-100>')
    expect(h).toContain('(default 80)')
    expect(h).toContain('-o, --out <folder>')
    expect(h).toContain('-h, --help')
    expect(h).toContain('\nExamples:\n  filesmith compress *.jpg --quality 70\n')
  })

  it('every help page fits 80 columns', () => {
    const pages = [
      renderRootHelp(),
      renderGroupHelp('pdf'),
      renderGroupHelp('skill'),
      ...COMMANDS.map(renderHelp)
    ]
    for (const page of pages)
      for (const line of page.split('\n')) expect(line.length, line).toBeLessThanOrEqual(80)
  })

  it('root help lists every top-level command and the pdf group', () => {
    const h = renderRootHelp()
    for (const v of [
      'convert',
      'compress',
      'resize',
      'upscale',
      'removebg',
      'generate',
      'formats',
      'doctor',
      'setup'
    ])
      expect(h).toContain(`  ${v}`)
    expect(h).toContain('  pdf <tool>')
    expect(h).toContain('  skill <install|status>')
  })

  it('pdf group help lists its tools', () => {
    const h = renderGroupHelp('pdf')
    for (const t of [
      'merge',
      'split',
      'burst',
      'extract-text',
      'to-images',
      'extract-images',
      'compress'
    ])
      expect(h).toContain(`  ${t}`)
  })

  it('wrap keeps words whole and indents continuation lines', () => {
    expect(wrap('aa bb cc', 8, 4)).toEqual(['aa', '    bb', '    cc'])
  })
})
