import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { planPdfJobs } from '../src/cli/planPdf'
import { UsageError } from '../src/cli/exit'
import { fileKind } from '@shared/fileKind'
import type { FileInfo, JobOptions } from '@shared/types'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-pdfplan-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const file = (name: string, size = 10): FileInfo => {
  writeFileSync(join(dir, name), 'x')
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return { path: join(dir, name), name, ext, kind: fileKind(ext), size }
}
const built = (options: JobOptions) => ({ options, warnings: [], explicit: new Set<string>() })
const env = { hasRar: true, readiness: { ok: true as const } }

describe('planPdfJobs', () => {
  it('merge is one job in argument order next to the first input', () => {
    const files = [file('cover.pdf', 5), file('body.pdf', 7)]
    const r = planPdfJobs('pdf merge', files, built({ op: 'merge' }), env)
    expect(r.jobs).toHaveLength(1)
    expect(r.jobs[0]).toMatchObject({
      id: '1',
      input: join(dir, 'cover.pdf'),
      inputs: [join(dir, 'cover.pdf'), join(dir, 'body.pdf')],
      inSize: 12,
      tool: 'pdf',
      op: 'pdf/merge',
      state: 'ready',
      output: { path: join(dir, 'cover (merged).pdf'), kind: 'file' }
    })
    expect(r.jobs[0].options.mergeInputs).toEqual([join(dir, 'cover.pdf'), join(dir, 'body.pdf')])
  })

  it('merge needs two or more PDFs and nothing else', () => {
    expect(() => planPdfJobs('pdf merge', [file('a.pdf')], built({ op: 'merge' }), env)).toThrow(
      /at least two PDFs/
    )
    expect(() =>
      planPdfJobs('pdf merge', [file('a.pdf'), file('b.docx')], built({ op: 'merge' }), env)
    ).toThrow(UsageError)
  })

  it('other tools plan one job per PDF, folders for folder outputs', () => {
    const r = planPdfJobs(
      'pdf burst',
      [file('a.pdf'), file('b.png')],
      built({ op: 'split-pages' }),
      env
    )
    expect(r.jobs.map((j) => [j.state, j.op])).toEqual([
      ['ready', 'pdf/split-pages'],
      ['error', 'pdf']
    ])
    expect(r.jobs[0].output).toEqual({ path: join(dir, 'a (split)'), kind: 'dir' })
  })
})
