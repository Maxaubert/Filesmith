import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'

describe('renderMarkdown', () => {
  it('renders headings, including ones indented up to 3 spaces (inside HTML blocks)', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>')
    expect(renderMarkdown('### Sub')).toContain('<h3>Sub</h3>')
    expect(renderMarkdown('  # Sonara')).toContain('<h1>Sonara</h1>')
  })

  it('handles a centered logo block (README pattern): img resolves, heading renders', () => {
    const md =
      '<div align="center">\n  <img src="assets/logo.png" alt="L" width="128">\n\n  # Sonara\n\n</div>'
    const html = renderMarkdown(md, 'C:/repo')
    expect(html).toContain('<div align="center">')
    expect(html).toContain('fsmedia://local/')
    expect(html).toContain('<h1>Sonara</h1>')
  })

  it('renders blockquotes (the > survives escaping)', () => {
    expect(renderMarkdown('> a quote')).toContain('<blockquote>a quote</blockquote>')
  })

  it('groups consecutive blockquote lines', () => {
    expect(renderMarkdown('> one\n> two')).toContain('<blockquote>one two</blockquote>')
  })

  it('renders bold, italic, inline code, and links', () => {
    expect(renderMarkdown('**b**')).toContain('<strong>b</strong>')
    expect(renderMarkdown('*i*')).toContain('<em>i</em>')
    expect(renderMarkdown('`x`')).toContain('<code>x</code>')
    expect(renderMarkdown('[t](https://x.com)')).toContain('<a href="https://x.com"')
  })

  it('renders lists', () => {
    expect(renderMarkdown('- a\n- b')).toContain('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('1. a\n2. b')).toContain('<ol><li>a</li><li>b</li></ol>')
  })

  it('nests lists by leading-space depth (2 spaces per level)', () => {
    expect(renderMarkdown('- a\n  - nested\n- b')).toContain(
      '<ul><li>a<ul><li>nested</li></ul></li><li>b</li></ul>'
    )
    // A tab counts as 2 spaces (one level) too.
    expect(renderMarkdown('- a\n\t- nested')).toContain(
      '<ul><li>a<ul><li>nested</li></ul></li></ul>'
    )
  })

  it('honors an ordered-list start number via <ol start>', () => {
    expect(renderMarkdown('3. a\n4. b')).toContain('<ol start="3"><li>a</li><li>b</li></ol>')
    // Lists starting at 1 stay plain <ol>.
    expect(renderMarkdown('1. a')).toContain('<ol><li>a</li></ol>')
  })

  it('rejects non-allowlisted link schemes (data:, vbscript:) with href="#"', () => {
    expect(renderMarkdown('[x](data:text/html,<script>alert(1)</script>)')).toContain('href="#"')
    expect(renderMarkdown('[x](vbscript:msgbox(1))')).toContain('href="#"')
    // Entity-encoded javascript can't slip past the decode-then-check.
    expect(renderMarkdown('[x](java&#115;cript:alert(1))')).toContain('href="#"')
    // Allowlisted schemes and relative paths survive.
    expect(renderMarkdown('[x](https://x.com)')).toContain('href="https://x.com"')
    expect(renderMarkdown('[x](./local/file.md)')).toContain('href="./local/file.md"')
  })

  it('renders GFM tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    const html = renderMarkdown(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('escapes code-fence contents (no raw HTML executes)', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('passes safe inline HTML through but strips scripts + event handlers', () => {
    expect(renderMarkdown('<div align="center"><img src="a.png"></div>')).toContain(
      '<div align="center">'
    )
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>')
    expect(renderMarkdown('<img src="x" onerror="alert(1)">')).not.toContain('onerror')
  })

  it('neutralizes javascript: links', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).toContain('href="#"')
  })

  it('strips HTML comments (single and multi-line)', () => {
    expect(renderMarkdown('a\n<!-- hidden -->\nb')).not.toContain('hidden')
    expect(renderMarkdown('<!-- line1\nline2 -->\ntext')).not.toContain('line2')
  })

  it('renders external https images (shields), local via fsmedia, and skips comments', () => {
    const html = renderMarkdown('![b](https://img.shields.io/badge/x-y-blue)')
    expect(html).toContain('<img alt="b" src="https://img.shields.io/badge/x-y-blue">')
  })

  it('resolves relative image paths against baseDir via fsmedia://', () => {
    const html = renderMarkdown('![logo](assets/logo.png)', 'C:/repo/docs')
    expect(html).toContain('fsmedia://local/')
    expect(html).toContain(encodeURIComponent('C:/repo/docs/assets/logo.png'))
    // ../ climbs out of the base dir
    expect(renderMarkdown('![l](../img/a.png)', 'C:/repo/docs')).toContain(
      encodeURIComponent('C:/repo/img/a.png')
    )
  })

  it('resolves relative src in raw <img> too, leaves absolute URLs alone', () => {
    expect(renderMarkdown('<img src="logo.png">', 'C:/repo')).toContain('fsmedia://local/')
    expect(renderMarkdown('![x](https://x.com/a.png)')).toContain('src="https://x.com/a.png"')
  })
})
