import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { planJobs, type PlanEnv } from '../src/cli/plan'
import { CliError } from '../src/cli/exit'
import { fileKind } from '@shared/fileKind'
import type { FileInfo, JobOptions } from '@shared/types'
import type { BuiltOptions } from '../src/cli/options'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fs-cliplan-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const file = (name: string): FileInfo => {
  writeFileSync(join(dir, name), 'x')
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return { path: join(dir, name), name, ext, kind: fileKind(ext), size: 100 }
}
const built = (options: JobOptions, over: Partial<BuiltOptions> = {}): BuiltOptions => ({
  options,
  warnings: [],
  explicit: new Set(),
  ...over
})
const env = (over: Partial<PlanEnv> = {}): PlanEnv => ({
  hasRar: true,
  readiness: { ok: true },
  ...over
})
const CONVERT = {
  format: '.webp',
  quality: 'balanced',
  store: true,
  dpi: 150,
  pageFormat: 'jpg',
  pageQuality: 100
}

describe('planJobs: convert', () => {
  it('routes each file and predicts its output', () => {
    const r = planJobs(
      'convert',
      [file('a.png'), file('b.cbz'), file('c.pdf')],
      built({ ...CONVERT, format: '.cbz' }),
      env()
    )
    expect(r.jobs.map((j) => [j.id, j.state, j.op])).toEqual([
      ['1', 'error', 'convert'],
      ['2', 'skip', 'convert'],
      ['3', 'ready', 'archive/from-pdf']
    ])
    expect(r.jobs[0]).toMatchObject({
      code: 'UNSUPPORTED_KIND',
      message: "Can't convert .png to .cbz."
    })
    expect(r.jobs[1]).toMatchObject({ code: 'SAME_FORMAT', message: 'already cbz' })
    expect(r.jobs[2].options).toMatchObject({ op: 'from-pdf', format: '.cbz', dpi: 150 })
    expect(r.jobs[2].output).toEqual({ path: join(dir, 'c.cbz'), kind: 'file' })
  })

  it('two sources on one name: predicted exactly as the real run names them', () => {
    const r = planJobs('convert', [file('photo.png'), file('photo.jpg')], built(CONVERT), env())
    expect(r.jobs.map((j) => j.output?.path)).toEqual([
      join(dir, 'photo.webp'),
      join(dir, 'photo (converted).webp')
    ])
    expect(readdirSync(dir).sort()).toEqual(['photo.jpg', 'photo.png'])
  })

  it('a RAR target without WinRAR stops the run before anything is planned', () => {
    expect(() =>
      planJobs(
        'convert',
        [file('a.cbz')],
        built({ ...CONVERT, format: '.cbr' }),
        env({ hasRar: false })
      )
    ).toThrow(CliError)
  })

  it('nothing runnable: run error listing what the inputs share', () => {
    const r = planJobs('convert', [file('a.mp3'), file('b.wav')], built(CONVERT), env())
    expect(r.runError?.code).toBe('USAGE')
    expect(r.runError?.message).toMatch(
      /^Nothing to convert: 2 files cannot become webp \(a\.mp3, b\.wav\)\. Formats these inputs share: .*m4a/
    )
  })

  it('nothing runnable with a skip: the message counts both and names the failures', () => {
    const r = planJobs(
      'convert',
      [file('a.pdf'), file('photo.png')],
      built({ ...CONVERT, format: '.png' }),
      env()
    )
    expect(r.jobs.map((j) => j.state)).toEqual(['error', 'skip'])
    expect(r.runError?.code).toBe('USAGE')
    expect(r.runError?.message).toMatch(
      /^Nothing to convert: 1 file skipped \(already png\), 1 file cannot become png \(a\.pdf\)\./
    )
  })

  it('all skipped is not an error', () => {
    const r = planJobs('convert', [file('a.webp')], built(CONVERT), env())
    expect(r.runError).toBeUndefined()
    expect(r.jobs[0].state).toBe('skip')
  })

  it('--quality typed for a target it cannot affect is a warning', () => {
    const r = planJobs(
      'convert',
      [file('a.jpg')],
      built({ ...CONVERT, format: '.png' }, { explicit: new Set(['quality']) }),
      env()
    )
    expect(r.warnings.map((w) => w.code)).toEqual(['QUALITY_IGNORED'])
  })

  it('outDir goes into every job and its predicted path', () => {
    const out = join(dir, 'out')
    const r = planJobs('convert', [file('a.png')], built(CONVERT), env({ outDir: out }))
    expect(r.jobs[0].options.outDir).toBe(out)
    expect(r.jobs[0].output?.path).toBe(join(out, 'a.webp'))
  })
})

describe('planJobs: other verbs', () => {
  it('compress rejects what the compressors cannot handle', () => {
    const r = planJobs(
      'compress',
      [file('a.bmp'), file('b.txt'), file('c.jpg')],
      built({ imageFormat: 'keep' }),
      env()
    )
    expect(r.jobs.map((j) => j.state)).toEqual(['error', 'error', 'ready'])
  })

  it('a bare --codec aimed at video warns when audio files are in the batch', () => {
    const r = planJobs(
      'compress',
      [file('a.mp4'), file('b.mp3')],
      built({ videoCodec: 'h265', audioCodec: 'keep' }, { codecFor: 'video' }),
      env()
    )
    expect(r.warnings.map((w) => w.code)).toEqual(['CODEC_IGNORED'])
  })

  it('readiness failures stop the run with the setup hint', () => {
    try {
      planJobs(
        'upscale',
        [file('a.png')],
        built({ upscaleModel: 'pid' }),
        env({
          readiness: {
            ok: false,
            code: 'SETUP_REQUIRED',
            message: 'PiD is not installed.',
            hint: 'filesmith setup pid'
          }
        })
      )
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(CliError)
      expect((e as CliError).hint).toBe('filesmith setup pid')
    }
  })

  it('pdf compress runs the compress tool', () => {
    const r = planJobs(
      'pdf compress',
      [file('a.pdf'), file('b.png')],
      built({ pdfLevel: 'smallest', pdfGray: false }),
      env()
    )
    expect(r.jobs.map((j) => [j.state, j.tool])).toEqual([
      ['ready', 'compress'],
      ['error', 'compress']
    ])
  })
})
