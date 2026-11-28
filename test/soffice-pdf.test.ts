// A PDF opens in LibreOffice's Draw by default, which cannot export docx/odt/
// rtf. buildSofficeArgs must force the Writer PDF import for those targets
// (and only for a PDF source). HTML must stay on Draw: through Writer the text
// turns into images in side files that never reach the user. The live half spawns the bundled soffice and is
// skipped when resources/libreoffice has not been staged.
import { execFileSync } from 'child_process'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSofficeArgs } from '../src/main/tools/soffice'
import { getTool } from '../src/main/tools/registry'
import { fileKind } from '@shared/fileKind'
import type { FileInfo } from '@shared/types'

const INFILTER = '--infilter=writer_pdf_import'

describe('buildSofficeArgs infilter', () => {
  const args = (input: string, ext: string): string[] =>
    buildSofficeArgs(input, 'C:/out', 'C:/prof', ext)

  it('adds the Writer PDF import for a PDF source and a Writer target', () => {
    for (const ext of ['.docx', '.odt', '.rtf', '.DOCX']) {
      const a = args('C:/tmp/in.pdf', ext)
      expect(a).toContain(INFILTER)
      expect(a.indexOf(INFILTER)).toBeLessThan(a.indexOf('--convert-to'))
    }
  })

  it('matches the source extension case-insensitively', () => {
    expect(args('C:/tmp/in.PDF', 'docx')).toContain(INFILTER)
  })

  it('does not add it for non-PDF sources', () => {
    expect(args('C:/tmp/in.docx', 'pdf')).not.toContain(INFILTER)
    expect(args('C:/tmp/in.txt', 'docx')).not.toContain(INFILTER)
    expect(args('C:/tmp/in.md', 'odt')).not.toContain(INFILTER)
  })

  it('does not add it for a non-Writer target from a PDF', () => {
    expect(args('C:/tmp/in.pdf', 'txt')).not.toContain(INFILTER)
    expect(args('C:/tmp/in.pdf', '.html')).not.toContain(INFILTER)
    expect(args('C:/tmp/in.pdf', '.HTML')).not.toContain(INFILTER)
  })
})

const SOFFICE = resolve('resources/libreoffice/program/soffice.com')
const haveSoffice = existsSync(SOFFICE)
const root = mkdtempSync(join(tmpdir(), 'fs-soffice-pdf-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const info = (p: string): FileInfo => {
  const ext = p.slice(p.lastIndexOf('.')).toLowerCase()
  return {
    path: p,
    name: basename(p),
    ext,
    kind: fileKind(ext),
    size: statSync(p).size
  }
}
const ctx = { signal: new AbortController().signal, onProgress: (): void => {} }

function makePdf(): string {
  const txt = join(root, 'source.txt')
  writeFileSync(txt, 'Hello PDF world.\nSecond line of text.\n')
  execFileSync(SOFFICE, buildSofficeArgs(txt, root, join(root, 'profile-mk'), '.pdf'), {
    stdio: 'ignore',
    timeout: 120_000
  })
  return join(root, 'source.pdf')
}

describe.skipIf(!haveSoffice)('PDF to Word-family convert (live)', () => {
  let sourcePdf = ''
  beforeAll(() => {
    sourcePdf = makePdf()
  }, 120_000)

  it.each(['.docx', '.odt', '.rtf', '.html'])(
    'converts a PDF to %s',
    async (ext) => {
      const pdf = join(root, `doc${ext.slice(1)}.pdf`)
      copyFileSync(sourcePdf, pdf)
      const out = await getTool('convert')!.run(info(pdf), { format: ext }, ctx)
      expect(out).toBeTruthy()
      expect(existsSync(out)).toBe(true)
      expect(statSync(out).size).toBeGreaterThan(0)
      if (ext === '.html') {
        const html = readFileSync(out, 'utf8')
        expect(html).toContain('Hello PDF world.')
        expect(html).toContain('Second line of text.')
      }
    },
    90_000
  )

  it('still converts txt to docx and docx to pdf', async () => {
    const txt = join(root, 'plain.txt')
    writeFileSync(txt, 'plain text\n')
    const docx = await getTool('convert')!.run(info(txt), { format: '.docx' }, ctx)
    expect(statSync(docx).size).toBeGreaterThan(0)
    const pdfOut = await getTool('convert')!.run(info(docx), { format: '.pdf' }, ctx)
    expect(statSync(pdfOut).size).toBeGreaterThan(0)
  }, 120_000)
})
