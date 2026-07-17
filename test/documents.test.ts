import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { convertGroup, convertTargets, familyFormats } from '../src/shared/convert'
import {
  buildSofficeArgs,
  sofficeFilter,
  sofficeOutputPath
} from '../src/main/tools/soffice'
import {
  buildPdfCompressArgs,
  buildPdfImagesArgs,
  buildPdfTextArgs
} from '../src/main/tools/pdf'
import { uniqueOutDir } from '../src/main/output'

describe('document convert targets', () => {
  it('offers word-family targets for a .docx (PDF etc., not its own format)', () => {
    const t = convertTargets('document', '.docx').map((x) => x.ext)
    expect(t).toContain('.pdf')
    expect(t).toContain('.odt')
    expect(t).toContain('.txt')
    expect(t).not.toContain('.docx')
  })

  it('offers spreadsheet targets for a .xlsx', () => {
    const t = convertTargets('document', '.xlsx').map((x) => x.ext)
    expect(t).toContain('.pdf')
    expect(t).toContain('.csv')
    expect(t).not.toContain('.docx') // word formats don't apply to a sheet
    expect(t).not.toContain('.xlsx')
  })

  it('offers editable targets for a PDF source', () => {
    const t = convertTargets('pdf', '.pdf').map((x) => x.ext)
    expect(t).toContain('.docx')
    expect(t).toContain('.txt')
    expect(t).not.toContain('.pdf')
  })

  it('offers document targets for plain text (.md)', () => {
    const t = convertTargets('text', '.md').map((x) => x.ext)
    expect(t).toContain('.pdf')
    expect(t).toContain('.docx')
  })

  it('groups word docs, text, and pdf together so they batch-convert as one', () => {
    // docx / md / pdf all share the 'doc' group -> multi-selectable together
    expect(convertGroup('document', '.docx')).toBe('doc')
    expect(convertGroup('text', '.md')).toBe('doc')
    expect(convertGroup('pdf', '.pdf')).toBe('doc')
    expect(convertGroup('text', '.txt')).toBe('doc')
    // spreadsheets and slides are their own groups (different targets)
    expect(convertGroup('document', '.xlsx')).toBe('sheet')
    expect(convertGroup('document', '.pptx')).toBe('slide')
    // media groups stay by kind
    expect(convertGroup('image', '.png')).toBe('image')
    expect(convertGroup('audio', '.mp3')).toBe('audio')
  })

  it('every family format has a dotted extension', () => {
    for (const src of ['.docx', '.xlsx', '.pptx', '.pdf', '.md'])
      for (const f of familyFormats(src === '.pdf' ? 'pdf' : src === '.md' ? 'text' : 'document', src))
        expect(f.ext.startsWith('.')).toBe(true)
  })
})

describe('soffice (LibreOffice) args', () => {
  it('uses the plain Text filter for .txt, bare ext otherwise', () => {
    expect(sofficeFilter('txt')).toBe('txt:Text')
    expect(sofficeFilter('.txt')).toBe('txt:Text')
    expect(sofficeFilter('.pdf')).toBe('pdf')
    expect(sofficeFilter('docx')).toBe('docx')
  })

  it('builds a headless convert command with an isolated profile', () => {
    const args = buildSofficeArgs('C:/in/a.docx', 'C:/tmp/out', 'C:/tmp/out/profile', '.pdf')
    expect(args).toContain('--headless')
    expect(args).toContain('--convert-to')
    expect(args).toContain('pdf')
    expect(args).toContain('--outdir')
    expect(args).toContain('C:/tmp/out')
    expect(args[args.length - 1]).toBe('C:/in/a.docx')
    expect(args.some((a) => a.startsWith('-env:UserInstallation='))).toBe(true)
  })

  it('predicts LibreOffice output filename in the outdir', () => {
    expect(sofficeOutputPath('C:/in/report.docx', 'C:/tmp', '.pdf')).toBe(join('C:/tmp', 'report.pdf'))
    expect(sofficeOutputPath('C:/in/report.docx', 'C:/tmp', 'txt')).toBe(join('C:/tmp', 'report.txt'))
  })
})

describe('mutool (PDF) args', () => {
  it('extract text: draw -F txt', () => {
    expect(buildPdfTextArgs('in.pdf', 'out.txt')).toEqual(['draw', '-F', 'txt', '-o', 'out.txt', 'in.pdf'])
  })
  it('pages to images: draw -F png at a DPI into a folder', () => {
    expect(buildPdfImagesArgs('in.pdf', 'C:/out', 150)).toEqual([
      'draw',
      '-F',
      'png',
      '-r',
      '150',
      '-o',
      join('C:/out', 'page-%d.png'),
      'in.pdf'
    ])
  })
  it('compress: clean -gggg -z, input before output', () => {
    expect(buildPdfCompressArgs('in.pdf', 'out.pdf')).toEqual([
      'clean',
      '-gggg',
      '-z',
      'in.pdf',
      'out.pdf'
    ])
  })
})

describe('uniqueOutDir', () => {
  it('returns the base name when free, then appends (2), (3) on collisions', () => {
    const root = mkdtempSync(join(tmpdir(), 'filesmith-test-'))
    try {
      const first = uniqueOutDir(root, 'pages')
      expect(first).toBe(join(root, 'pages'))
      mkdirSync(first)
      const second = uniqueOutDir(root, 'pages')
      expect(second).toBe(join(root, 'pages (2)'))
      mkdirSync(second)
      expect(uniqueOutDir(root, 'pages')).toBe(join(root, 'pages (3)'))
    } finally {
      rmSync(root, { recursive: true, force: true })
      expect(existsSync(root)).toBe(false)
    }
  })
})
